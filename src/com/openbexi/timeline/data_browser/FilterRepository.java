package com.openbexi.timeline.data_browser;

import org.json.JSONObject;
import org.json.JSONArray;
import java.io.IOException;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Namespace definitions and shared ownership, using the existing UI-selected identity. */
public final class FilterRepository {
    private FilterRepository() {}
    static final Set<String> GUEST=Set.of("ALL","NAMESPACE_Exclude_Nominal_RNG");
    static Path root(org.json.simple.JSONObject config){return Path.of(Objects.toString(config.get("_hbds_root"),"HBDS")).toAbsolutePath().normalize();}
    static String segment(String value){
        if(value.matches("[A-Za-z0-9_-]{1,128}"))return value;
        try{return "ns_"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))).substring(0,24);}
        catch(Exception error){throw new IllegalStateException(error);}
    }
    static JSONObject read(Path path) throws IOException {return new JSONObject(Files.readString(path));}
    static void write(Path path,Object value) throws IOException {
        Files.createDirectories(path.getParent());Path temporary=Files.createTempFile(path.getParent(),".filter-",".tmp");
        try{Files.writeString(temporary,value.toString(),StandardCharsets.UTF_8);
            try{Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);}
            catch(AtomicMoveNotSupportedException error){Files.move(temporary,path,StandardCopyOption.REPLACE_EXISTING);}
        }finally{Files.deleteIfExists(temporary);}
    }
    static Set<String> namespaces(org.json.simple.JSONObject config){
        Set<String> names=new LinkedHashSet<>();
        if(config.get("startup configuration") instanceof org.json.simple.JSONArray sources)
            for(Object value:sources)if(value instanceof org.json.simple.JSONObject source&&!"false".equals(Objects.toString(source.get("enable"))))names.add(Objects.toString(source.get("namespace"),""));
        return names;
    }
    static String scope(org.json.simple.JSONObject config){
        String selected=Objects.toString(config.get("namespace"),"");Set<String> names=namespaces(config);
        return !selected.isBlank()&&!selected.equals("0")?selected:names.size()==1?names.iterator().next():"_all";
    }
    static LinkedHashMap<String,JSONObject> users(Path root) throws IOException {
        LinkedHashMap<String,JSONObject> result=new LinkedHashMap<>();
        for(String file:List.of("defaults.json","index.json")){
            Path path=root.resolve("users").resolve(file);if(!Files.isRegularFile(path))continue;
            for(Object value:new JSONArray(Files.readString(path)))if(value instanceof JSONObject user&&user.has("id")){
                JSONObject previous=result.computeIfAbsent(user.getString("id"),key->new JSONObject());
                for(String key:user.keySet())previous.put(key,user.get(key));
            }
        }
        for(String name:List.of("admin","guest","arcazj"))result.putIfAbsent(name,new JSONObject().put("id",name).put("name",name).put("admin",name.equals("admin")));
        JSONObject guest=result.get("guest");
        for(JSONObject user:result.values()){
            if(!user.has("email"))user.put("email",user.getString("id")+"@example.invalid");
            if(!user.has("roleId"))user.put("roleId",user.optBoolean("admin")?"role_admin":guest.optString("roleId","role_guest"));
            if(!user.has("groupId"))user.put("groupId",user.optBoolean("admin")?"group_admin":guest.optString("groupId","group_guest"));
        }
        return result;
    }
    static boolean owns(JSONObject item,String actor){return item.optJSONArray("owners")!=null&&item.getJSONArray("owners").toList().contains(actor);}
    static void register(Path root,String scope,JSONArray filters,String actor,String workspace) throws IOException {
        var users=users(root);JSONObject guest=users.get("guest");
        users.putIfAbsent(actor,new JSONObject().put("id",actor).put("name",actor).put("admin",false).put("email",actor+"@example.invalid").put("roleId",guest.getString("roleId")).put("groupId",guest.getString("groupId")));
        for(JSONObject user:users.values()){
            JSONArray references=new JSONArray();
            for(Object value:user.optJSONArray("filters",new JSONArray()))if(value instanceof JSONObject item&&!(scope.equals(item.optString("namespace"))&&workspace.equals(item.optString("workspace"))))references.put(item);
            for(Object value:filters){JSONObject item=(JSONObject)value;if(owns(item,user.getString("id"))&&(!user.getString("id").equals("guest")||GUEST.contains(item.getString("name")))){
                JSONObject reference=new JSONObject().put("namespace",scope).put("name",item.getString("name")).put("access",user.getString("id").equals("guest")?"view":"owner");
                if(!workspace.isEmpty())reference.put("workspace",workspace);references.put(reference);
            }}
            user.put("filters",references);if(user.optBoolean("admin"))user.put("filterAccess","all");
        }
        Path index=root.resolve("users/index.json");JSONArray records=new JSONArray(users.values());
        if(!Files.isRegularFile(index)||!new JSONArray(Files.readString(index)).similar(records))write(index,records);
    }
    public static synchronized void apply(org.json.simple.JSONObject query,org.json.simple.JSONObject legacy,String operation) throws IOException {
        Path root=root(query);Files.createDirectories(root);
        try(var channel=java.nio.channels.FileChannel.open(root.resolve(".filter-ownership.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
            var lock=channel.lock(0,1,false)){applyLocked(query,legacy,operation);}
    }
    private static void applyLocked(org.json.simple.JSONObject query,org.json.simple.JSONObject legacy,String operation) throws IOException {
        Path root=root(query);String scope=scope(query),actor=Objects.toString(query.get("userName"),"guest").toLowerCase(Locale.ROOT);
        if(!actor.matches("[A-Za-z][A-Za-z0-9_.-]{0,95}"))throw new IllegalArgumentException("Invalid filter user.");
        String workspace=query.get("_hbds_workspace")==null?"":Path.of(query.get("_hbds_workspace").toString()).getFileName().toString().replaceFirst("\\.[^.]+$","");
        Path path=root.resolve("filters").resolve(segment(scope)).resolve("definitions"+(workspace.isEmpty()?"":"."+segment(workspace))+".json");
        JSONObject document;
        JSONObject previous=Files.isRegularFile(path)?read(path):null;
        if(previous!=null&&previous.optBoolean("legacyMigrationCompleted"))document=previous;
        else{
            LinkedHashMap<String,JSONObject> items=new LinkedHashMap<>();List<JSONObject> profiles=new ArrayList<>();
            if(previous!=null)for(Object value:previous.getJSONArray("filters")){JSONObject item=(JSONObject)value;items.put(item.getString("name"),item);}
            profiles.add(new JSONObject(legacy.toJSONString()));
            Path folder=root.resolve("filters");
            if(Files.isDirectory(folder))try(var files=Files.walk(folder)){
                for(Path profile:files.filter(p->p.getFileName().toString().endsWith("_filter_setting.json")).sorted(Comparator.comparing((Path p)->!p.getFileName().toString().startsWith("arcazj_")).thenComparing(Path::toString)).toList()){
                    if(!workspace.isEmpty()&&profile.toString().contains(FileSystems.getDefault().getSeparator()+"workspaces"+FileSystems.getDefault().getSeparator())&&!profile.toString().contains(FileSystems.getDefault().getSeparator()+workspace+FileSystems.getDefault().getSeparator()))continue;
                    profiles.add(read(profile));
                }
            }
            for(JSONObject profile:profiles){
                JSONArray timelines=profile.optJSONArray("openbexi_timeline");if(timelines==null||timelines.isEmpty())continue;
                JSONObject timeline=timelines.getJSONObject(0);Set<String> names=new HashSet<>();
                for(Object value:timeline.optJSONArray("sources",new JSONArray()))if(value instanceof JSONObject source)names.add(source.optString("namespace"));
                if(!names.isEmpty()&&Collections.disjoint(names,namespaces(query)))continue;
                if(!scope.equals("_all")&&!names.isEmpty()&&!names.contains(scope))continue;
                for(Object value:timeline.optJSONArray("filters",new JSONArray())){
                    JSONObject item=new JSONObject(value.toString());String name=item.optString("name");if(name.isBlank()||items.containsKey(name))continue;
                    item.remove("canEdit");item.put("namespace",scope);
                    if(!item.has("owners"))item.put("owners",GUEST.contains(name)?new JSONArray(List.of("arcazj","guest")):new JSONArray(List.of("arcazj")));
                    items.put(name,item);
                }
            }
            items.putIfAbsent("ALL",new JSONObject().put("name","ALL").put("filter_value","").put("sortBy","NONE").put("namespace",scope).put("owners",new JSONArray(List.of("arcazj","guest"))));
            document=new JSONObject().put("schemaVersion",1).put("legacyMigrationCompleted",true).put("namespace",scope).put("filters",new JSONArray(items.values()));write(path,document);
        }
        JSONArray filters=document.getJSONArray("filters");boolean admin=users(root).getOrDefault(actor,new JSONObject()).optBoolean("admin");
        String name=Objects.toString(query.get("filterName"),"");JSONObject selected=null;
        for(Object value:filters){JSONObject item=(JSONObject)value;if(name.equals(item.getString("name"))&&(admin||owns(item,actor))&&(!actor.equals("guest")||GUEST.contains(name)))selected=item;}
        if(operation.equals("updateFilter")&&selected==null)throw new SecurityException("This filter is unavailable for the selected user.");
        if(Set.of("addFilter","saveFilter","deleteFilter").contains(operation)){
            if(actor.equals("guest"))throw new SecurityException("Guest may view and apply filters only.");
            for(Object value:filters)if(((JSONObject)value).getString("name").equalsIgnoreCase(name)&&selected==null)throw new SecurityException("A filter with this name already exists.");
            if(operation.equals("addFilter")&&selected!=null)throw new IllegalArgumentException("A filter with this name already exists.");
            if(name.isBlank()||name.length()>512)throw new IllegalArgumentException("Enter a filter name of at most 512 characters.");
            if(operation.equals("deleteFilter")){
                if(selected==null)throw new IllegalArgumentException("Filter not found.");
                for(int i=filters.length()-1;i>=0;i--)if(filters.get(i)==selected)filters.remove(i);selected=null;
            }else{
                if(selected==null){selected=new JSONObject().put("name",name).put("namespace",scope).put("owners",new JSONArray(GUEST.contains(name)?List.of(actor,"guest"):List.of(actor)));filters.put(selected);}
                selected.put("filter_value",Objects.toString(query.get("filter"),"")).put("sortBy",Objects.toString(query.get("sortBy"),"NONE")).put("backgroundColor",Objects.toString(query.get("backgroundColor"),"#eef1f2"));
            }
            write(path,document);
        }
        register(root,scope,filters,actor,workspace);
        JSONObject timeline=new JSONObject(((org.json.simple.JSONArray)legacy.get("openbexi_timeline")).get(0).toString());String active="ALL";
        for(Object value:timeline.getJSONArray("filters")){JSONObject item=(JSONObject)value;if(item.optString("current").equals("yes"))active=item.getString("name");}
        if(selected!=null)active=selected.getString("name");JSONArray visible=new JSONArray();boolean current=false;
        for(Object value:filters){JSONObject item=new JSONObject(value.toString());if(!admin&&!owns(item,actor))continue;
            if(actor.equals("guest")&&!GUEST.contains(item.getString("name")))continue;
            boolean chosen=active.equals(item.getString("name"));current|=chosen;
            item.put("canEdit",!actor.equals("guest")&&(admin||owns(item,actor))).put("current",chosen?"yes":"no");visible.put(item);}
        if(!current&&!visible.isEmpty())visible.getJSONObject(0).put("current","yes");
        timeline.put("filters",visible).put("filterAccess",new JSONObject().put("user",actor).put("canCreate",!actor.equals("guest")).put("admin",admin).put("identityMode","ui"));
        try{((org.json.simple.JSONArray)legacy.get("openbexi_timeline")).set(0,new org.json.simple.parser.JSONParser().parse(timeline.toString()));}
        catch(org.json.simple.parser.ParseException error){throw new IOException(error);}
    }
}
