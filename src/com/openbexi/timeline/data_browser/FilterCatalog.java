package com.openbexi.timeline.data_browser;

import org.json.JSONObject;
import org.json.JSONArray;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.*;
import java.io.IOException;

/** Historical catalogs scan changed source files only; no record payload crosses the API. */
public final class FilterCatalog {
    private FilterCatalog() {}
    private static final Set<String> HIDDEN=Set.of("description","asrun","start","end","id","title","namespace","sourcerecordkey","sortbyvalue","analyze");
    private static final Map<String,State> STATES=new ConcurrentHashMap<>();
    private record Publication(String stamp,org.json.simple.JSONObject document){}
    private static final Map<Path,Publication> PUBLICATIONS=new HashMap<>();
    private static org.json.simple.JSONObject publication(Path root) throws IOException {
        Path path=CollectorPublication.path(root);if(!Files.isRegularFile(path)){PUBLICATIONS.remove(path);return null;}
        String stamp=Files.size(path)+":"+Files.getLastModifiedTime(path).toMillis();Publication cached=PUBLICATIONS.get(path);
        if(cached!=null&&cached.stamp.equals(stamp))return cached.document;
        var document=CollectorPublication.read(root);PUBLICATIONS.put(path,new Publication(stamp,document));return document;
    }
    private static final ScheduledExecutorService WORKER=Executors.newScheduledThreadPool(1,task->{Thread thread=new Thread(task,"timeline-filter-catalog");thread.setDaemon(true);return thread;});
    private static final class State {String signature;ScheduledFuture<?> job;volatile boolean indexing=true;volatile String error="";volatile JSONObject result=new JSONObject().put("version",1).put("namespaces",new JSONArray());}
    private static String workspace(org.json.simple.JSONObject config){return config.get("_hbds_workspace")==null?"":Path.of(config.get("_hbds_workspace").toString()).getFileName().toString().replaceFirst("\\.[^.]+$","");}
    private static Path path(org.json.simple.JSONObject config,String namespace){
        String scope=workspace(config);return FilterRepository.root(config).resolve("filters").resolve(FilterRepository.segment(namespace)).resolve("catalog.java"+(scope.isEmpty()?"":"."+FilterRepository.segment(scope))+".json");
    }
    private static String binding(org.json.simple.JSONObject source){
        JSONObject value=new JSONObject();for(String key:List.of("type","namespace","data_model","filter","enable"))value.put(key,source.get(key));return value.toString();
    }
    static JSONObject limits(){
        JSONObject policy=new JSONObject().put("maxValues",Integer.parseInt(System.getenv().getOrDefault("OPENBEXI_FILTER_MAX_VALUES","1000")))
            .put("minSamples",Integer.parseInt(System.getenv().getOrDefault("OPENBEXI_FILTER_MIN_SAMPLES","200")))
            .put("uniqueRatio",Double.parseDouble(System.getenv().getOrDefault("OPENBEXI_FILTER_UNIQUE_RATIO","0.9")));
        if(policy.getInt("maxValues")<2||policy.getInt("minSamples")<3||policy.getDouble("uniqueRatio")<=0||policy.getDouble("uniqueRatio")>1)throw new IllegalArgumentException("Invalid filter catalog limits.");
        return policy;
    }
    private static void fields(JSONObject data,String prefix,JSONObject result,JSONObject policy,int depth){
        if(depth>16)return;
        for(String key:data.keySet()){
            if(!key.matches("[A-Za-z_][A-Za-z0-9_-]*")||HIDDEN.contains(key.replaceAll("[_-]","").toLowerCase(Locale.ROOT)))continue;
            Object value=data.get(key);String field=prefix+key;
            if(value instanceof JSONObject nested){fields(nested,field+".",result,policy,depth+1);continue;}
            if(value instanceof JSONArray)continue;
            JSONObject item=result.optJSONObject(field);if(item==null){item=new JSONObject().put("seen",0).put("values",new JSONObject()).put("overflow",false);result.put(field,item);}
            item.put("seen",item.getLong("seen")+1);String token=JSONObject.valueToString(value);JSONObject values=item.getJSONObject("values");
            if(token.length()>1024)item.put("overflow",true);
            else if(values.has(token))values.put(token,values.getLong(token)+1);
            else if(values.length()<policy.getInt("maxValues")+1)values.put(token,1);
            else item.put("overflow",true);
        }
    }
    private static void collect(JSONObject record,JSONObject result,JSONObject policy){
        if(record.optBoolean("zone"))return;
        JSONObject data=new JSONObject(record.optJSONObject("data",new JSONObject()).toString());
        for(String key:record.keySet())if(!Set.of("data","activities","render").contains(key)&&!data.has(key))data.put(key,record.get(key));
        fields(data,"",result,policy,0);
        for(Object value:record.optJSONArray("activities",new JSONArray()))if(value instanceof JSONObject child)collect(child,result,policy);
    }
    private static void project(JSONObject catalog,JSONObject policy){
        JSONObject combined=new JSONObject();
        for(String file:catalog.getJSONObject("files").keySet()){
            JSONObject fields=catalog.getJSONObject("files").getJSONObject(file).getJSONObject("attributes");
            for(String field:fields.keySet()){
                JSONObject part=fields.getJSONObject(field),total=combined.optJSONObject(field);
                if(total==null){total=new JSONObject().put("seen",0).put("overflow",false).put("values",new JSONObject());combined.put(field,total);}
                total.put("seen",total.getLong("seen")+part.getLong("seen")).put("overflow",total.getBoolean("overflow")||part.getBoolean("overflow"));
                JSONObject values=total.getJSONObject("values");
                for(String value:part.getJSONObject("values").keySet()){
                    if(values.has(value)||values.length()<=policy.getInt("maxValues"))values.put(value,values.optLong(value)+part.getJSONObject("values").getLong(value));
                    else total.put("overflow",true);
                }
            }
        }
        JSONArray attributes=new JSONArray(),excluded=new JSONArray();
        for(String field:new TreeSet<>(combined.keySet())){
            JSONObject item=combined.getJSONObject(field),values=item.getJSONObject("values");int distinct=values.length();long seen=item.getLong("seen");
            if(item.getBoolean("overflow")||distinct>policy.getInt("maxValues")||seen>=policy.getInt("minSamples")&&(double)distinct/seen>=policy.getDouble("uniqueRatio")){
                excluded.put(new JSONObject().put("field",field).put("seen",seen).put("distinct",distinct).put("reason","high_cardinality"));continue;
            }
            JSONArray choices=new JSONArray();for(String token:new TreeSet<>(values.keySet()))choices.put(new org.json.JSONTokener(token).nextValue());
            attributes.put(new JSONObject().put("field",field).put("seen",seen).put("distinct",distinct).put("values",choices));
        }
        catalog.put("attributes",attributes).put("excluded",excluded);
    }
    public static synchronized JSONObject scan(org.json.simple.JSONObject configuration) throws IOException {
        JSONObject policy=limits();Map<String,JSONObject> catalogs=new TreeMap<>(),previousFiles=new HashMap<>();
        Set<String> warnings=new LinkedHashSet<>();
        if(configuration.get("startup configuration") instanceof org.json.simple.JSONArray sources)for(Object raw:sources){
            if(!(raw instanceof org.json.simple.JSONObject source)||!"json_file".equals(source.get("type"))||"false".equals(Objects.toString(source.get("enable"))))continue;
            String namespace=Objects.toString(source.get("namespace"),"");
            Path target=path(configuration,namespace);
            JSONObject catalog=catalogs.get(namespace);
            if(catalog==null){
                Path legacy=target.resolveSibling("catalog.java.json");Path stored=Files.isRegularFile(target)?target:legacy;
                JSONObject old=Files.isRegularFile(stored)?FilterRepository.read(stored):new JSONObject();
                JSONObject oldFiles=old.optJSONObject("limits",new JSONObject()).similar(policy)?old.optJSONObject("files",new JSONObject()):new JSONObject();
                previousFiles.put(namespace,oldFiles);
                catalog=new JSONObject().put("schemaVersion",1).put("namespace",namespace).put("limits",policy).put("files",new JSONObject());catalogs.put(namespace,catalog);
            }
            try{
                Path root=CollectorPublication.root(Objects.toString(source.get("data_model"),""));
                var accept=SourceFileFilters.compile(source,root);var publication=publication(root);
                var sourceFilter=FilterExpression.source(source);
                List<Path> candidates=new ArrayList<>();
                if(Files.isRegularFile(root,LinkOption.NOFOLLOW_LINKS)){if(accept.test(root))candidates.add(root);}
                else if(Files.isDirectory(root,LinkOption.NOFOLLOW_LINKS))Files.walkFileTree(root,EnumSet.noneOf(FileVisitOption.class),32,new SimpleFileVisitor<>(){
                    private boolean omitted(Path path){String name=path.getFileName().toString();return name.startsWith(".")||name.startsWith("descriptors")||name.contains("noises");}
                    @Override public FileVisitResult preVisitDirectory(Path directory,BasicFileAttributes attributes){return !directory.equals(root)&&omitted(directory)?FileVisitResult.SKIP_SUBTREE:FileVisitResult.CONTINUE;}
                    @Override public FileVisitResult visitFile(Path path,BasicFileAttributes attributes){
                        if(attributes.isRegularFile()&&!attributes.isSymbolicLink()&&!omitted(path)&&path.getFileName().toString().endsWith(".json")&&accept.test(path)&&!CollectorPublication.excluded(root,path,publication))candidates.add(path);
                        else if(attributes.isDirectory())warnings.add("A source directory for "+namespace+" exceeds the catalog scan depth limit.");
                        return FileVisitResult.CONTINUE;
                    }
                    @Override public FileVisitResult visitFileFailed(Path path,IOException error){warnings.add("Some source files for "+namespace+" could not be cataloged; the next scan will retry them.");return FileVisitResult.CONTINUE;}
                });
                else throw new IOException("Source unavailable");
                for(Path path:candidates){
                    if(path.toString().contains(FileSystems.getDefault().getSeparator()+".timeline-collector"+FileSystems.getDefault().getSeparator()))continue;
                    String key=FilterRepository.segment(binding(source)+path.toAbsolutePath()),stamp=Files.size(path)+":"+Files.getLastModifiedTime(path).toMillis();
                    JSONObject cached=previousFiles.get(namespace).optJSONObject(key);
                    if(cached!=null&&stamp.equals(cached.optString("stamp"))){catalog.getJSONObject("files").put(key,cached);continue;}
                    try{
                        if(Files.size(path)>64L*1024*1024)throw new IOException("Source exceeds catalog read limit");
                        JSONObject document=FilterRepository.read(path),summary=new JSONObject();
                        JSONArray records=document.optJSONArray("events");if(records==null)continue;
                        for(Object value:records)if(value instanceof JSONObject record){
                            org.json.simple.JSONObject simple=(org.json.simple.JSONObject)new org.json.simple.parser.JSONParser().parse(record.toString());
                            if(sourceFilter.test(simple))collect(record,summary,policy);
                        }
                        if(!stamp.equals(Files.size(path)+":"+Files.getLastModifiedTime(path).toMillis()))throw new IOException("Source changed during scan");
                        catalog.getJSONObject("files").put(key,new JSONObject().put("stamp",stamp).put("attributes",summary));
                    }catch(Exception error){if(cached!=null)catalog.getJSONObject("files").put(key,cached);warnings.add("Some source files for "+namespace+" could not be cataloged; the next scan will retry them.");}
                }
                if(publication!=null){
                    Path manifest=CollectorPublication.path(root);String key="collector_"+FilterRepository.segment(root+binding(source));
                    String stamp=Files.size(manifest)+":"+Files.getLastModifiedTime(manifest).toMillis();JSONObject cached=previousFiles.get(namespace).optJSONObject(key);
                    if(cached!=null&&stamp.equals(cached.optString("stamp")))catalog.getJSONObject("files").put(key,cached);
                    else{JSONObject summary=new JSONObject();
                        for(Object value:(org.json.simple.JSONArray)publication.get("events"))if(sourceFilter.test((org.json.simple.JSONObject)value))collect(new JSONObject(value.toString()),summary,policy);
                        catalog.getJSONObject("files").put(key,new JSONObject().put("stamp",stamp).put("attributes",summary));
                    }
                }
            }catch(Exception error){warnings.add("A configured source for "+namespace+" is unavailable; its catalog may be incomplete.");
                JSONObject old=previousFiles.get(namespace);for(String key:old.keySet())if(!catalog.getJSONObject("files").has(key))catalog.getJSONObject("files").put(key,old.get(key));}
        }
        JSONArray result=new JSONArray();
        for(var entry:catalogs.entrySet()){
            JSONObject catalog=entry.getValue();project(catalog,policy);catalog.put("updatedAt",System.currentTimeMillis()/1000.0);
            Path path=path(configuration,entry.getKey());
            if(!Files.isRegularFile(path)||!FilterRepository.read(path).getJSONObject("files").similar(catalog.getJSONObject("files"))||!FilterRepository.read(path).getJSONObject("limits").similar(policy))FilterRepository.write(path,catalog);
            result.put(new JSONObject().put("namespace",entry.getKey()).put("attributes",catalog.getJSONArray("attributes")).put("excluded",catalog.getJSONArray("excluded")).put("updatedAt",catalog.get("updatedAt")));
        }
        return new JSONObject().put("version",1).put("namespaces",result).put("limits",policy).put("warnings",new JSONArray(warnings));
    }
    public static JSONObject read(org.json.simple.JSONObject configuration){
        String signature=configuration.get("startup configuration") instanceof org.json.simple.JSONArray sources?sources.stream().map(value->binding((org.json.simple.JSONObject)value)).toList().toString():"[]";
        String context=workspace(configuration);String key=FilterRepository.root(configuration)+":"+(context.isEmpty()?signature:context);
        State state=STATES.compute(key,(ignored,old)->{
            if(old!=null&&signature.equals(old.signature))return old;
            if(old!=null&&old.job!=null)old.job.cancel(false);
            State created=new State();created.signature=signature;
            created.job=WORKER.scheduleWithFixedDelay(()->{
                created.indexing=true;
                try{created.result=scan(configuration);created.error="";}catch(Exception error){created.error="Filter catalog is unavailable; retrying.";}
                finally{created.indexing=false;}
            },0,5,TimeUnit.SECONDS);return created;});
        JSONObject response=new JSONObject(state.result.toString()).put("indexing",state.indexing);
        if(!state.error.isEmpty())response.put("error",state.error);
        return new JSONObject().put("filterCatalog",response);
    }
}
