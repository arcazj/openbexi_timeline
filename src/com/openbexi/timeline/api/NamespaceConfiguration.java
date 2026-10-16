package com.openbexi.timeline.api;

import org.json.*;
import org.yaml.snakeyaml.*;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.*;

/** Namespace YAML is authoritative; this supplies the existing editor projection. */
public final class NamespaceConfiguration {
    private static final Map<Path,NamespaceConfiguration> ACTIVE=new ConcurrentHashMap<>();
    private static final Pattern NAME=Pattern.compile("^[A-Za-z][A-Za-z0-9_-]{0,63}$");
    private final Path root, metadata, servicePath, workspacePath, selectedWorkspace;
    private List<Path> paths;
    private final Map<String,Path> models=new LinkedHashMap<>();
    private JSONObject cached, service;
    private JSONObject defaultIds=new JSONObject();
    private String stamp="";
    private long generation;

    public NamespaceConfiguration(Path root,List<Path> paths,Path servicePath,Path metadata) throws IOException {
        this(root,paths,servicePath,metadata,null);
    }
    public NamespaceConfiguration(Path root,List<Path> paths,Path servicePath,Path metadata,Path workspacePath) throws IOException {
        this.root=root.toAbsolutePath().normalize();
        this.paths=paths.stream().map(p->p.toAbsolutePath().normalize()).toList();
        if(this.paths.isEmpty())throw new IllegalArgumentException("At least one namespace file is required");
        if(new HashSet<>(this.paths).size()!=this.paths.size())throw new IllegalArgumentException("Repeated configuration file");
        this.servicePath=servicePath==null?null:servicePath.toAbsolutePath().normalize();
        Path base=this.paths.get(0).getParent();
        this.metadata=metadata!=null?metadata.toAbsolutePath().normalize():base.getFileName().toString().equals("yaml")?base.getParent():base;
        this.workspacePath=workspacePath!=null?workspacePath.toAbsolutePath().normalize():this.metadata.resolve("workspace.json");
        this.selectedWorkspace=workspacePath==null?null:this.workspacePath;
        read();
    }
    /** Workspace filenames are relative to the HBDS directory, independent of the launch directory. */
    public static List<Path> workspaceFiles(Path file) throws IOException {
        Path workspace=file.toAbsolutePath().normalize();
        JSONArray files=yaml(workspace).optJSONArray("namespace_files");
        if(files==null||files.isEmpty())throw new IllegalArgumentException("Workspace requires a nonempty namespace_files list of filenames");
        List<Path> selected=new ArrayList<>();
        for(Object item:files) {
            if(!(item instanceof String name)||name.isBlank())throw new IllegalArgumentException("Workspace requires a nonempty namespace_files list of filenames");
            selected.add(workspace.getParent().resolve(name).normalize());
        }
        return List.copyOf(selected);
    }
    public static Path workspaceService(Path file) throws IOException {
        Path workspace=file.toAbsolutePath().normalize();JSONObject document=yaml(workspace);
        if(document.has("service")) {
            if(!(document.get("service") instanceof String service)||service.isBlank())throw new IllegalArgumentException("Workspace service must be a filename");
            return workspace.getParent().resolve(service).normalize();
        }
        Path local=workspace.getParent().resolve("service.local.yml");
        return Files.isRegularFile(local)?local:workspace.getParent().resolve("service.yml");
    }
    public static NamespaceConfiguration find(Path path){return ACTIVE.get(path.toAbsolutePath().normalize());}
    public Path register() {
        String id=UUID.nameUUIDFromBytes((workspacePath+"|"+servicePath+"|"+paths).getBytes(StandardCharsets.UTF_8)).toString();
        Path key=root.resolve(".local-private/workspaces/"+id+".hbds.json");ACTIVE.put(key,this);return key;
    }
    public JSONObject service(){return new JSONObject(service.toString());}
    public Path metadataRoot(){return metadata;}
    public Path selectedWorkspace(){return selectedWorkspace;}
    public synchronized JSONObject describe(){return new JSONObject().put("kind","namespace-files").put("files",new JSONArray(paths.stream().map(p->p.getFileName().toString()).toList())).put("service",servicePath==null?JSONObject.NULL:servicePath.getFileName().toString()).put("workspace",workspacePath.getFileName().toString()).put("defaultIds",new JSONObject(defaultIds.toString()));}
    public synchronized long generation() throws IOException {read(false);return generation;}
    public Path lockPath(){return metadata.resolve(".workspace.lock");}
    public static JSONObject yaml(Path file) throws IOException {
        if(Files.size(file)>2*1024*1024)throw new IllegalArgumentException("Configuration exceeds 2 MiB");
        LoaderOptions options=new LoaderOptions();options.setAllowDuplicateKeys(false);
        try(Reader reader=Files.newBufferedReader(file)) {
            Object value=new Yaml(new SafeConstructor(options)).load(reader);
            if(!(value instanceof Map<?,?> map))throw new IllegalArgumentException("Configuration must be a mapping");
            return new JSONObject(map);
        }
    }
    private static boolean name(String value){return NAME.matcher(value).matches()&&!value.matches("(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])");}
    private static String path(String value,Path base) {
        Matcher matcher=Pattern.compile("\\$\\{([A-Za-z_][A-Za-z0-9_]*)}").matcher(value);StringBuffer out=new StringBuffer();
        while(matcher.find()) {String env=System.getenv(matcher.group(1));if(env==null)throw new IllegalArgumentException("Missing environment variable: "+matcher.group(1));matcher.appendReplacement(out,Matcher.quoteReplacement(env));}matcher.appendTail(out);value=out.toString();
        if(value.isBlank())throw new IllegalArgumentException("Path must be nonempty");
        if(value.contains("://")) {URI uri=URI.create(value);if(uri.getAuthority()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new IllegalArgumentException("Invalid source URI");return value;}
        if(value.matches("^[A-Za-z]:[/\\\\].*")||value.startsWith("/"))return Path.of(value).normalize().toString().replace('\\','/');
        return base.resolve(value).normalize().toAbsolutePath().toString().replace('\\','/');
    }
    private static boolean containsNamespace(String value,String namespace) {
        if(value.contains("://"))value=URI.create(value).getPath();
        return Arrays.asList(value.replace('\\','/').split("/")).contains(namespace);
    }
    private static String modelName(String model) {String filename=model.replace('\\','/');filename=filename.substring(filename.lastIndexOf('/')+1);if(!filename.endsWith(".json"))throw new IllegalArgumentException("Model must be JSON");return filename.substring(0,filename.length()-5);}
    private JSONObject namespace(Path file) throws IOException {
        JSONObject value=yaml(file);
        if(!(value.opt("config_version") instanceof Integer)||(value.getInt("config_version")!=2&&value.getInt("config_version")!=3))throw new IllegalArgumentException("Namespace requires config_version: 2 or 3");
        String namespace=value.getString("namespace"),model=value.getString("model"),stem=modelName(model);
        if(!name(namespace)||!name(stem))throw new IllegalArgumentException("Namespace and model names must be portable identifiers");
        if(!file.getFileName().toString().equals(namespace+"_"+stem+".yml"))throw new IllegalArgumentException("Filename must match <namespace>_<model_name>.yml");
        for(String key:List.of("server","timeline_server","data_sources","source_path","source_plugin","converter_plugin"))if(value.has(key))throw new IllegalArgumentException(key+" does not belong at namespace level");
        for(String[] alias:List.<String[]>of(new String[]{"data_model","target_path"}))if(value.has(alias[0])) {if(value.has(alias[1])&&!Objects.equals(value.get(alias[0]),value.get(alias[1])))throw new IllegalArgumentException("Conflicting path fields");value.put(alias[1],value.remove(alias[0]));}
        String target=path(value.getString("target_path"),file.getParent());
        if(value.has("allow_external_namespace_path")&&!(value.get("allow_external_namespace_path") instanceof Boolean))throw new IllegalArgumentException("allow_external_namespace_path must be boolean");
        if(target.contains("://")||!value.optBoolean("allow_external_namespace_path",false)&&!containsNamespace(target,namespace))throw new IllegalArgumentException("Target must be local and contain the namespace, or explicitly allow an external namespace path");
        value.put("target_path",target).put("model",path(model,metadata));
        if(!Path.of(value.getString("model")).toAbsolutePath().normalize().startsWith(metadata.resolve("models")))throw new IllegalArgumentException("Display models must be located in HBDS/models");
        if(value.has("enable")&&!(value.get("enable") instanceof Boolean))throw new IllegalArgumentException("enable must be boolean");
        JSONArray sources=value.getJSONArray("sources");if(sources.isEmpty())throw new IllegalArgumentException("Sources cannot be empty");Set<String> ids=new HashSet<>();
        for(Object item:sources) {JSONObject source=(JSONObject)item;String id=source.getString("id");if(!NAME.matcher(id).matches()||!ids.add(id.toLowerCase(Locale.ROOT)))throw new IllegalArgumentException("Source IDs must be unique portable identifiers");
            for(String key:List.of("enable","allow_external_namespace_path"))if(source.has(key)&&!(source.get(key) instanceof Boolean))throw new IllegalArgumentException(key+" must be boolean");
            for(String key:List.of("source_plugin","converter_plugin"))if(!NAME.matcher(source.getString(key)).matches())throw new IllegalArgumentException("Invalid plugin identifier");
            if(source.has("data_path")){if(source.has("source_path")&&!Objects.equals(source.get("source_path"),source.get("data_path")))throw new IllegalArgumentException("Conflicting path fields");source.put("source_path",source.remove("data_path"));}
            if(source.has("options")&&!(source.get("options") instanceof JSONObject))throw new IllegalArgumentException("Plugin options must be a mapping");
            if(source.has("source_path")) {String location=path(source.getString("source_path"),file.getParent());if(!source.optBoolean("allow_external_namespace_path",false)&&!containsNamespace(location,namespace))throw new IllegalArgumentException("Source path requires its namespace or an explicit exception");source.put("source_path",location);}
            else if(value.getInt("config_version")==2&&!source.getString("source_plugin").equals("oracle"))throw new IllegalArgumentException("Source requires source_path");
        }
        return value;
    }
    private Path defaultsPath(String name) {
        if(!Set.of("users","groups","roles").contains(name))return null;
        for(Path base:List.of(metadata,root.resolve("HBDS"))) {
            Path file=base.resolve(name+"/defaults.json");if(Files.exists(file))return file;
        }
        return null;
    }
    /** Public defaults are read-only; private index entries override them by ID. */
    private JSONArray registry(String name,boolean defaultsOnly) throws IOException {
        Map<String,JSONObject> records=new LinkedHashMap<>();List<Path> files=new ArrayList<>();
        Path defaults=defaultsPath(name);if(defaults!=null)files.add(defaults);
        if(!defaultsOnly)files.add(metadata.resolve(name+"/index.json"));
        for(Path file:files)if(Files.exists(file)) {
            Set<String> seen=new HashSet<>();
            for(Object item:new JSONArray(Files.readString(file))) {
                JSONObject entry=(JSONObject)item;String id=entry.getString("id");
                if(!seen.add(id))throw new IllegalArgumentException("Duplicate "+name+" identity: "+id);
                records.put(id,entry);
            }
        }
        return new JSONArray(records.values());
    }
    private String diskStamp() throws IOException {
        List<Path> files=new ArrayList<>(paths);files.addAll(models.values());if(servicePath!=null)files.add(servicePath);
        if(Files.isDirectory(metadata.resolve("models")))try(var entries=Files.list(metadata.resolve("models"))){entries.filter(p->p.toString().endsWith(".json")).sorted().forEach(files::add);}
        if(Files.exists(workspacePath))files.add(workspacePath);
        for(String key:List.of("users/index.json","groups/index.json","roles/index.json","grants/index.json")){Path file=metadata.resolve(key);if(Files.exists(file))files.add(file);}
        for(String key:List.of("users","groups","roles")){Path file=defaultsPath(key);if(file!=null)files.add(file);}
        StringBuilder out=new StringBuilder();for(Path file:files)out.append(file).append(':').append(Files.getLastModifiedTime(file)).append(':').append(Files.size(file));return out.toString();
    }
    private void resolveAliases() throws IOException {
        Path workspace=workspacePath;if(!Files.exists(workspace))return;
        JSONObject aliases=new JSONObject(Files.readString(workspace)).optJSONObject("aliases",new JSONObject());
        List<Path> resolved=new ArrayList<>();
        for(Path selected:paths){Set<String> seen=new HashSet<>();while(aliases.has(selected.getFileName().toString())){
            if(!seen.add(selected.getFileName().toString()))throw new IllegalArgumentException("Cyclic namespace filename alias");
            String alias=aliases.getString(selected.getFileName().toString());
            if(!Path.of(alias).getFileName().toString().equals(alias)||!alias.endsWith(".yml"))throw new IllegalArgumentException("Workspace alias must be a namespace filename");
            selected=selected.resolveSibling(alias);
        }resolved.add(selected);}
        if(new HashSet<>(resolved).size()!=resolved.size())throw new IllegalArgumentException("Repeated namespace file");paths=resolved;
    }
    public synchronized JSONObject read() throws IOException {return read(true);}
    private JSONObject read(boolean copy) throws IOException {
        resolveAliases();String next=diskStamp();if(cached!=null&&next.equals(stamp))return copy?new JSONObject(cached.toString()):cached;
        service=servicePath==null?new JSONObject():yaml(servicePath);
        if(servicePath!=null&&(!(service.opt("config_version") instanceof Integer)||(service.getInt("config_version")!=2&&service.getInt("config_version")!=3)))throw new IllegalArgumentException("Service requires config_version: 2 or 3");
        for(String key:List.of("namespace","sources","data_sources"))if(service.has(key))throw new IllegalArgumentException("Service cannot own namespace data");
        JSONObject result=new JSONObject().put("schemaVersion",1).put("deployment",new JSONObject(service.toString()));
        result.getJSONObject("deployment").remove("connectors");result.getJSONObject("deployment").remove("config_version");
        for(String key:List.of("namespaces","models","sources","connectors","tabs","users","groups","roles","grants"))result.put(key,new JSONArray());
        Map<String,JSONObject> listeners=new LinkedHashMap<>();List<Map.Entry<String,Integer>> bindings=new ArrayList<>();
        if(service.has("connectors")&&!(service.get("connectors") instanceof JSONArray))throw new IllegalArgumentException("Service connectors must be a list");
        for(Object item:service.optJSONArray("connectors",new JSONArray())) {JSONObject c=(JSONObject)item;String id=c.getString("id"),type=c.getString("type"),owner=c.getString("owner"),host=c.optString("host","127.0.0.1");int port=c.getInt("port");
            if(!NAME.matcher(id).matches()||listeners.put(id,c)!=null)throw new IllegalArgumentException("Duplicate or invalid connector ID");
            if(!Set.of("http","no_secure","https","secure","secure_sse").contains(type)||!Set.of("java","python").contains(owner)||port<1||port>65535)throw new IllegalArgumentException("Invalid connector type, owner or port");
            if(!(c.get("port") instanceof Integer)||host.isBlank())throw new IllegalArgumentException("Port must be an integer and host nonempty");
            if(c.has("enable")&&!(c.get("enable") instanceof Boolean))throw new IllegalArgumentException("Connector enable must be boolean");
            String binding=host.equals("localhost")?"127.0.0.1":host;
            if(c.optBoolean("enable",true)){for(var previous:bindings)if(previous.getValue()==port&&(previous.getKey().equals(binding)||Set.of("0.0.0.0","::").contains(binding)||Set.of("0.0.0.0","::").contains(previous.getKey())))throw new IllegalArgumentException("Conflicting connector bindings");bindings.add(Map.entry(binding,port));}c.put("host",host);
            if(!Set.of("http","no_secure").contains(type)) {JSONObject tls=c.getJSONObject("tls");for(String field:owner.equals("java")?List.of("keystore"):List.of("certfile","keyfile"))tls.put(field,path(tls.getString(field),servicePath.getParent()));if(owner.equals("java"))tls.getString("password_env");}
            result.getJSONArray("connectors").put(new JSONObject().put("id",id).put("protocol",type).put("port",port));
        }
        Set<String> names=new HashSet<>(),targets=new HashSet<>();models.clear();int order=0;
        for(Path file:paths) {JSONObject ns=namespace(file);String name=ns.getString("namespace"),target=ns.getString("target_path").toLowerCase(Locale.ROOT),mid="model_"+modelName(ns.getString("model"));
            if(!names.add(name.toLowerCase(Locale.ROOT)))throw new IllegalArgumentException("Duplicate namespace");
            for(String old:targets)if(old.equals(target)||old.startsWith(target+"/")||target.startsWith(old+"/"))throw new IllegalArgumentException("Output paths overlap");targets.add(target);
            if(ns.has("connectors")&&!(ns.get("connectors") instanceof JSONArray))throw new IllegalArgumentException("Namespace connectors must be a list");
            JSONArray refs=ns.optJSONArray("connectors",new JSONArray());Set<String> seen=new HashSet<>();for(Object ref:refs)if(!(ref instanceof String)||!seen.add((String)ref)||!listeners.containsKey(ref))throw new IllegalArgumentException("Invalid connector reference");
            Path model=Path.of(ns.getString("model"));if(models.containsKey(mid)&&!models.get(mid).equals(model))throw new IllegalArgumentException("Model filenames must be unique");
            if(!models.containsKey(mid))result.getJSONArray("models").put(new JSONObject().put("id",mid).put("configuration",new JSONObject(Files.readString(model))));models.put(mid,model);
            result.getJSONArray("namespaces").put(new JSONObject().put("id",name).put("namespace",name).put("modelId",mid).put("render",ns.optJSONObject("render",new JSONObject())).put("filter",ns.optJSONObject("filter",new JSONObject())).put("connectorIds",refs));
            result.getJSONArray("tabs").put(new JSONObject().put("id","tab_"+name).put("namespaceId",name).put("title",name).put("order",order).put("enabled",ns.optBoolean("enable",true)));
            JSONObject entry=new JSONObject(ns.toString());for(String key:List.of("namespace","model","config_version","connectors","render","filter"))entry.remove(key);entry.put("type","json_file");
            result.getJSONArray("sources").put(new JSONObject().put("id","source_"+name).put("namespaceId",name).put("order",order++).put("configuration",entry));
        }
        if(Files.isDirectory(metadata.resolve("models")))try(var entries=Files.list(metadata.resolve("models"))){for(Path model:entries.filter(p->p.toString().endsWith(".json")).sorted().toList()){
            String id="model_"+modelName(model.toString());if(!models.containsKey(id)){models.put(id,model);result.getJSONArray("models").put(new JSONObject().put("id",id).put("configuration",new JSONObject(Files.readString(model))));}
        }}
        for(String key:List.of("users","groups","roles","grants"))result.put(key,registry(key,false));
        JSONObject requiredIds=new JSONObject();
        for(String key:List.of("users","groups","roles")) {
            JSONArray ids=new JSONArray();for(Object item:registry(key,true))ids.put(((JSONObject)item).getString("id"));requiredIds.put(key,ids);
        }
        JSONArray visibleGrants=new JSONArray();for(Object item:result.getJSONArray("grants"))if(names.contains(((JSONObject)item).getString("namespaceId").toLowerCase(Locale.ROOT)))visibleGrants.put(item);result.put("grants",visibleGrants);
        result.put("defaultNamespaceId",result.getJSONArray("namespaces").getJSONObject(0).getString("id"));
        Path workspace=workspacePath;if(Files.exists(workspace)){
            JSONObject state=new JSONObject(Files.readString(workspace));JSONArray tabs=state.optJSONArray("tabs",new JSONArray());Set<String> selected=new HashSet<>();
            for(Object item:tabs)selected.add(((JSONObject)item).getString("namespaceId").toLowerCase(Locale.ROOT));
            if(selected.equals(names)){result.put("tabs",tabs).put("defaultNamespaceId",state.optString("default_namespace_id",result.getString("defaultNamespaceId")));}
        }
        cached=result;defaultIds=requiredIds;stamp=diskStamp();generation++;return copy?new JSONObject(result.toString()):result;
    }
    private String workspaceReference(Path file) {
        Path base=workspacePath.getParent();
        return (Objects.equals(base.getRoot(),file.getRoot())?base.relativize(file):file).toString().replace('\\','/');
    }
    public synchronized void save(JSONObject value) throws IOException {
        JSONObject current=read();
        if(!value.getJSONArray("connectors").similar(current.getJSONArray("connectors"))||!value.getJSONObject("deployment").similar(current.getJSONObject("deployment")))throw new ApiException(422,"Edit listeners in the service configuration and restart");
        if(value.getJSONArray("namespaces").length()!=paths.size())throw new ApiException(422,"Change the startup file list to add/remove namespaces");
        Map<Path,String> writes=new LinkedHashMap<>();List<Path> nextPaths=new ArrayList<>();
        for(int i=0;i<paths.size();i++) {Path old=paths.get(i);JSONObject original=yaml(old);String name=original.getString("namespace");JSONObject ns=null;
            for(Object item:value.getJSONArray("namespaces"))if(((JSONObject)item).getString("id").equals(name))ns=(JSONObject)item;
            if(ns==null||!ns.getString("namespace").equals(name))throw new ApiException(422,"Namespace identity requires explicit migration");
            JSONObject previousNs=current.getJSONArray("namespaces").getJSONObject(i);
            JSONArray beforeSources=new JSONArray(),afterSources=new JSONArray();
            for(Object item:current.getJSONArray("sources"))if(((JSONObject)item).getString("namespaceId").equals(name))beforeSources.put(item);
            for(Object item:value.getJSONArray("sources"))if(((JSONObject)item).getString("namespaceId").equals(name))afterSources.put(item);
            if(ns.similar(previousNs)&&afterSources.similar(beforeSources)){nextPaths.add(old);continue;}
            Path model=models.get(ns.getString("modelId"));if(model==null)throw new ApiException(422,"Select an existing model");
            if(afterSources.length()!=1)throw new ApiException(422,"Edit the sources list within its namespace");
            JSONObject before=beforeSources.getJSONObject(0).getJSONObject("configuration"),after=afterSources.getJSONObject(0).getJSONObject("configuration");
            Set<String> keys=new HashSet<>(before.keySet());keys.addAll(after.keySet());
            for(String key:keys)if(!key.equals("type")&&!Objects.equals(before.toMap().get(key),after.toMap().get(key))){if(after.has(key))original.put(key,after.get(key));else original.remove(key);}
            if(!ns.getString("modelId").equals(previousNs.getString("modelId")))original.put("model","models/"+model.getFileName());
            for(String key:List.of("render","filter"))if(!ns.getJSONObject(key).similar(previousNs.getJSONObject(key)))original.put(key,ns.getJSONObject(key));
            if(!ns.getJSONArray("connectorIds").similar(previousNs.getJSONArray("connectorIds")))original.put("connectors",ns.getJSONArray("connectorIds"));
            Path destination=old.resolveSibling(name+"_"+modelName(model.toString())+".yml");if(!destination.equals(old)&&Files.exists(destination))throw new ApiException(409,"Configuration filename already exists");
            if(!original.similar(yaml(old)))writes.put(destination,new Yaml().dump(original.toMap()));nextPaths.add(destination);
        }
        for(Object item:value.getJSONArray("models")) {JSONObject model=(JSONObject)item;Path location=models.get(model.getString("id"));if(location!=null&&!new JSONObject(Files.readString(location)).similar(model.getJSONObject("configuration")))writes.put(location,model.getJSONObject("configuration").toString(2)+"\n");}
        for(String key:List.of("users","groups","roles","grants"))if(!current.getJSONArray(key).similar(value.getJSONArray(key))){Path file=metadata.resolve(key+"/index.json");JSONArray content=new JSONArray(value.getJSONArray(key).toString());
            Map<String,JSONObject> defaults=new LinkedHashMap<>();for(Object item:registry(key,true)){JSONObject entry=(JSONObject)item;defaults.put(entry.getString("id"),entry);}
            Set<String> present=new HashSet<>();JSONArray privateEntries=new JSONArray();
            for(Object item:content){JSONObject entry=(JSONObject)item;String id=entry.getString("id");present.add(id);if(!entry.similar(defaults.get(id)))privateEntries.put(entry);}
            if(!present.containsAll(defaults.keySet()))throw new ApiException(422,"Default "+key+" must remain present; changes are stored privately");
            content=privateEntries;
            if(key.equals("grants")&&Files.exists(file)){Set<String> selected=new HashSet<>();for(Object item:current.getJSONArray("namespaces"))selected.add(((JSONObject)item).getString("id"));for(Object item:new JSONArray(Files.readString(file)))if(!selected.contains(((JSONObject)item).getString("namespaceId")))content.put(item);}
            writes.put(file,content.toString(2)+"\n");}
        Path workspace=workspacePath;JSONObject state=Files.exists(workspace)?new JSONObject(Files.readString(workspace)):new JSONObject();JSONObject aliases=state.optJSONObject("aliases",new JSONObject());
        for(int i=0;i<paths.size();i++)if(!paths.get(i).equals(nextPaths.get(i))){String old=paths.get(i).getFileName().toString(),fresh=nextPaths.get(i).getFileName().toString();for(String key:aliases.keySet())if(aliases.getString(key).equals(old))aliases.put(key,fresh);aliases.put(old,fresh);}
        if(!paths.equals(nextPaths)||!value.getJSONArray("tabs").similar(current.getJSONArray("tabs"))||!value.getString("defaultNamespaceId").equals(current.getString("defaultNamespaceId"))){
            state.put("aliases",aliases).put("namespace_files",new JSONArray(nextPaths.stream().map(this::workspaceReference).toList())).put("tabs",value.getJSONArray("tabs")).put("default_namespace_id",value.getString("defaultNamespaceId"));writes.put(workspace,state.toString(2)+"\n");
        }
        List<Path> originalPaths=paths;Map<Path,byte[]> backup=new LinkedHashMap<>();try {for(var entry:writes.entrySet()){Path file=entry.getKey();backup.put(file,Files.exists(file)?Files.readAllBytes(file):null);atomic(file,entry.getValue());}paths=nextPaths;stamp="";read();}
        catch(IOException|RuntimeException error){for(var entry:backup.entrySet())if(entry.getValue()==null)Files.deleteIfExists(entry.getKey());else atomic(entry.getKey(),new String(entry.getValue(),StandardCharsets.UTF_8));paths=originalPaths;stamp="";cached=null;throw error;}
    }
    private static void atomic(Path file,String text) throws IOException {Files.createDirectories(file.getParent());Path tmp=Files.createTempFile(file.getParent(),"namespace-",".part");try{Files.writeString(tmp,text);TimelineAtomicFiles.replace(tmp,file);}finally{Files.deleteIfExists(tmp);}}
}
