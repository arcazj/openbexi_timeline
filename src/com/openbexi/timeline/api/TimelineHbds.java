package com.openbexi.timeline.api;

import org.everit.json.schema.Schema;
import org.everit.json.schema.ValidationException;
import org.everit.json.schema.loader.SchemaLoader;
import org.json.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Canonical HBDS configuration and a bounded, immutable provider snapshot. */
public final class TimelineHbds {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final Map<Path,TimelineHbds> STORES = new ConcurrentHashMap<>();
    private final Path root, file;
    private final Schema schema, legacyModelSchema;
    private final TimelineModels modelValidator;
    private JSONObject document, providerBaseline;
    private String revision;
    private FileTime modified;
    private long length;

    private TimelineHbds(Path root, Path file) throws IOException {
        this.root=root.toRealPath(); this.file=file.toAbsolutePath().normalize();
        schema=SchemaLoader.builder().schemaJson(schema()).draftV7Support().build().load().build();
        legacyModelSchema=SchemaLoader.builder().schemaJson(new JSONObject(Files.readString(this.root.resolve("schemas/legacy-model.schema.json"))))
                .draftV7Support().build().load().build();
        modelValidator=new TimelineModels(this.root);
        if(!Files.isRegularFile(this.file))throw new ApiException(503,"The active HBDS configuration file is unavailable.");
        byte[] bytes=readBytes(this.file);
        document=parse(bytes); validate(document); revision=digest(bytes); providerBaseline=copy(document);
        stamp();
    }
    public static TimelineHbds open(Path root, Path file) throws IOException {
        Path key=file.toAbsolutePath().normalize();
        synchronized(STORES) {
            Path publicTemplates=root.toAbsolutePath().normalize().resolve("HBDS/templates");
            if(key.startsWith(publicTemplates)) {
                Path privateCopy=root.resolve("HBDS/private/configurations").resolve(key.getFileName()).toAbsolutePath().normalize();
                Files.createDirectories(privateCopy.getParent());Path lockPath=privateCopy.resolveSibling(privateCopy.getFileName()+".lock");
                if(Files.isSymbolicLink(privateCopy)||Files.isSymbolicLink(privateCopy.getParent())||Files.isSymbolicLink(lockPath))throw new IOException("HBDS storage cannot be a symbolic link.");
                try(FileChannel channel=FileChannel.open(lockPath,StandardOpenOption.CREATE,StandardOpenOption.WRITE);FileLock ignored=channel.lock()) {
                    if(!Files.exists(privateCopy)) {
                        Path temporary=Files.createTempFile(privateCopy.getParent(),"hbds-promote-",".tmp");
                        try {Files.write(temporary,readBytes(key));TimelineAtomicFiles.replace(temporary,privateCopy);}
                        finally {Files.deleteIfExists(temporary);}
                    }
                }
                key=privateCopy;
            }
            TimelineHbds store=STORES.get(key);
            if(store==null) {store=new TimelineHbds(root,key);STORES.put(key,store);}
            return store;
        }
    }
    public static Path selected(Path root, String dataConfiguration) {
        String configured=System.getProperty("openbexi.hbds.config",System.getenv("OPENBEXI_HBDS_CONFIG"));
        if(configured!=null&&!configured.isBlank())return resolve(root,configured);
        if(dataConfiguration!=null&&!dataConfiguration.isBlank()) {
            Path candidate=resolve(root,dataConfiguration);
            if(canonical(candidate))return candidate;
            throw new ApiException(503,"The active configuration has not been migrated to HBDS.");
        }
        return root.resolve("HBDS/templates/default.hbds.json");
    }
    /** Migration maps win over legacy files so there is exactly one active configuration. */
    public static Path resolve(Path root,String configuration) {
        Path absoluteRoot=root.toAbsolutePath().normalize(),path=absoluteRoot.resolve(configuration).normalize();
        if(!path.startsWith(absoluteRoot))return path;
        String relative=absoluteRoot.relativize(path).toString().replace('\\','/');
        for(String mapping:List.of("HBDS/private/migration.json","HBDS/aliases.json")) {
            Path aliases=absoluteRoot.resolve(mapping);
            if(!Files.isRegularFile(aliases))continue;
            try {
                JSONObject values=new JSONObject(Files.readString(aliases)).getJSONObject("aliases");
                if(values.has(relative)) {
                    Path resolved=absoluteRoot.resolve(values.getString(relative)).normalize();
                    if(!resolved.startsWith(absoluteRoot))throw new IllegalArgumentException("HBDS alias escapes the project root.");
                    return resolved;
                }
            } catch(IOException error){throw new IllegalStateException("Cannot read HBDS migration map.",error);}
        }
        return path;
    }
    public static boolean canonical(Path file) {return file.toString().toLowerCase(Locale.ROOT).endsWith(".hbds.json");}
    public static Path projectRoot(Path configuration) {
        for(Path path=configuration.toAbsolutePath().getParent();path!=null;path=path.getParent())
            if(Files.isRegularFile(path.resolve("HBDS/schema/configuration.schema.json")))return path;
        return Path.of("").toAbsolutePath();
    }
    private static JSONObject copy(JSONObject value) {return new JSONObject(value.toString());}
    private static byte[] readBytes(Path path) throws IOException {
        if(Files.isSymbolicLink(path))throw new IOException("HBDS configuration cannot be a symbolic link.");
        try(InputStream stream=Files.newInputStream(path,LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes=stream.readNBytes(MAX_BYTES+1);
            if(bytes.length>MAX_BYTES)throw new ApiException(413,"HBDS configuration exceeds 2 MiB.");
            return bytes;
        }
    }
    private static JSONObject parse(byte[] bytes) {
        JSONTokener parser=new JSONTokener(new String(bytes,StandardCharsets.UTF_8),new JSONParserConfiguration().withStrictMode().withMaxNestingDepth(100));
        JSONObject result=new JSONObject(parser);
        if(parser.nextClean()!=0)throw new ApiException(422,"Unexpected content after HBDS JSON.");
        return result;
    }
    private static String digest(byte[] bytes) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
        catch(NoSuchAlgorithmException error){throw new IllegalStateException(error);}
    }
    public JSONObject schema() throws IOException {return new JSONObject(Files.readString(root.resolve("HBDS/schema/configuration.schema.json")));}
    private void stamp() throws IOException {BasicFileAttributes attributes=Files.readAttributes(file,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);modified=attributes.lastModifiedTime();length=attributes.size();}
    /** Each request performs one metadata check; JSON is reparsed only after an external edit. */
    private void refresh() {
        try {
            BasicFileAttributes attributes=Files.readAttributes(file,BasicFileAttributes.class,LinkOption.NOFOLLOW_LINKS);
            if(Objects.equals(modified,attributes.lastModifiedTime())&&length==attributes.size())return;
            modified=attributes.lastModifiedTime();length=attributes.size();
            byte[] bytes=readBytes(file);JSONObject candidate=parse(bytes);validate(candidate);
            document=candidate;revision=digest(bytes);modified=attributes.lastModifiedTime();length=attributes.size();
        } catch(IOException|RuntimeException ignored) { /* Keep the last valid active snapshot. A save still checks the actual disk revision. */ }
    }
    public synchronized String etag() {refresh();return "\""+revision+"\"";}
    public synchronized JSONObject read() {refresh();JSONArray reasons=restartReasons(document);return new JSONObject().put("document",copy(document)).put("revision",revision)
            .put("restartRequired",!reasons.isEmpty()).put("restartReasons",reasons);}
    private static Map<String,JSONObject> index(JSONObject value,String key) {
        Map<String,JSONObject> result=new LinkedHashMap<>();
        for(Object item:value.getJSONArray(key)) {
            JSONObject record=(JSONObject)item;String id=record.getString("id");
            if(result.put(id,record)!=null)throw new ApiException(422,"Duplicate "+key+" identity: "+id);
        }
        return result;
    }
    private static void reference(Map<String,JSONObject> records,String id,String field) {
        if(!records.containsKey(id))throw new ApiException(422,field+" references an unknown identity.");
    }
    public void validate(JSONObject value) {
        safe(value,0);
        try{schema.validate(value);}catch(ValidationException error){throw new ApiException(422,String.join("; ",error.getAllMessages()));}
        Set<String> allIds=new HashSet<>();for(String key:List.of("namespaces","models","sources","connectors","tabs","users","roles","groups","grants"))
            for(Object item:value.getJSONArray(key))if(!allIds.add(((JSONObject)item).getString("id")))throw new ApiException(422,"HBDS entity IDs must be globally unique.");
        Map<String,JSONObject> namespaces=index(value,"namespaces"),models=index(value,"models"),connectors=index(value,"connectors"),
                groups=index(value,"groups"),roles=index(value,"roles");
        index(value,"sources");index(value,"tabs");index(value,"users");index(value,"grants");
        reference(namespaces,value.getString("defaultNamespaceId"),"defaultNamespaceId");
        Set<String> names=new HashSet<>(),grants=new HashSet<>();
        Set<String> servingNamespaces=new HashSet<>();for(Object item:value.getJSONArray("sources")) {
            JSONObject source=(JSONObject)item;if(source.getJSONObject("configuration").optString("type").equals("json_file"))servingNamespaces.add(source.getString("namespaceId"));
        }
        for(JSONObject namespace:namespaces.values()) {
            validateFilter(namespace.getJSONObject("filter"),servingNamespaces.contains(namespace.getString("id")));
            if(!names.add(namespace.getString("namespace")))throw new ApiException(422,"Namespace names must be unique.");
            reference(models,namespace.getString("modelId"),"namespace.modelId");
            for(Object id:namespace.getJSONArray("connectorIds"))reference(connectors,(String)id,"namespace.connectorIds");
        }
        for(JSONObject model:models.values()) {
            JSONObject config=model.getJSONObject("configuration");
            if(config.has("dataSource"))modelValidator.validate(config);
            else try {legacyModelSchema.validate(config);TimelineModels.validateRendering(config);
                Set<String> bands=new HashSet<>();for(Object band:config.getJSONArray("bands"))
                    if(!bands.add(((JSONObject)band).getString("name")))throw new ApiException(422,"Band names must be unique.");
            } catch(ValidationException error){throw new ApiException(422,String.join("; ",error.getAllMessages()));}
        }
        for(String key:List.of("sources","tabs","grants"))for(Object item:value.getJSONArray(key))
            reference(namespaces,((JSONObject)item).getString("namespaceId"),key+".namespaceId");
        Set<String> sourceOrders=new HashSet<>();for(Object item:value.getJSONArray("sources")) {
            JSONObject source=(JSONObject)item;
            validateFilter(source.getJSONObject("configuration").optJSONObject("filter"),source.getJSONObject("configuration").optString("type").equals("json_file"));
            if(source.getJSONObject("configuration").has("namespace"))throw new ApiException(422,"Source namespace belongs in namespaceId.");
            if(!sourceOrders.add(source.getString("namespaceId")+":"+source.getInt("order")))throw new ApiException(422,"Source order must be unique within a namespace.");
        }
        Set<Integer> tabOrders=new HashSet<>();boolean enabled=false;for(Object item:value.getJSONArray("tabs")) {
            JSONObject tab=(JSONObject)item;enabled|=tab.getBoolean("enabled");
            if(!tabOrders.add(tab.getInt("order")))throw new ApiException(422,"Tab order must be unique.");
        }
        if(!enabled)throw new ApiException(422,"At least one timeline tab must be enabled.");
        for(Object item:value.getJSONArray("users")) {
            JSONObject user=(JSONObject)item;reference(roles,user.getString("roleId"),"user.roleId");reference(groups,user.getString("groupId"),"user.groupId");
            if(user.getBoolean("admin")&&!roles.get(user.getString("roleId")).getString("ceiling").equals("admin"))throw new ApiException(422,"Administrator users require an admin role ceiling.");
        }
        for(Object item:value.getJSONArray("grants")) {
            JSONObject grant=(JSONObject)item;reference(groups,grant.getString("groupId"),"grant.groupId");
            if(!grants.add(grant.getString("groupId")+"\n"+grant.getString("namespaceId")))throw new ApiException(422,"Only one grant is allowed per group and namespace.");
        }
        if(value.getJSONObject("deployment").has("model")||value.getJSONObject("deployment").has("data_sources"))throw new ApiException(422,"Models and sources belong in their HBDS collections.");
    }
    private static void safe(Object value,int depth) {
        if(depth>80)throw new ApiException(422,"HBDS nesting exceeds 80 levels.");
        if(value instanceof JSONObject object)for(String key:object.keySet()) {
            if(Set.of("__proto__","prototype","constructor").contains(key))throw new ApiException(422,"Unsafe HBDS property: "+key);
            safe(object.get(key),depth+1);
        } else if(value instanceof JSONArray array)for(Object child:array)safe(child,depth+1);
    }
    private static void validateFilter(JSONObject filter,boolean serving) {
        if(filter==null)return;
        for(String key:List.of("include","exclude"))if(filter.opt(key) instanceof String expression&&(serving||expression.startsWith("expr:"))) {
            try {com.openbexi.timeline.data_browser.FilterExpression.compile(expression);}
            catch(IllegalArgumentException error){throw new ApiException(422,"Invalid source filter "+key+": "+error.getMessage());}
        }
    }
    private static boolean equal(Object a,Object b) {return Objects.equals(a instanceof JSONObject j?j.toMap():a instanceof JSONArray ar?ar.toList():a,
            b instanceof JSONObject j?j.toMap():b instanceof JSONArray ar?ar.toList():b);}
    private static JSONArray changedNamespaces(JSONObject before,JSONObject after) {
        Set<String> changed=new LinkedHashSet<>();Map<String,JSONObject> old=index(before,"namespaces"),fresh=index(after,"namespaces");
        Map<String,JSONObject> oldModels=index(before,"models"),newModels=index(after,"models");
        Set<String> ids=new LinkedHashSet<>(old.keySet());ids.addAll(fresh.keySet());
        for(String id:ids) {
            JSONObject a=old.get(id),b=fresh.get(id);
            if(!equal(a,b)||a!=null&&b!=null&&!equal(oldModels.get(a.getString("modelId")),newModels.get(b.getString("modelId"))))changed.add(id);
        }
        for(String key:List.of("sources"))if(!equal(before.get(key),after.get(key))) {
            Map<String,JSONObject> a=index(before,key),b=index(after,key);Set<String> entries=new LinkedHashSet<>(a.keySet());entries.addAll(b.keySet());
            for(String id:entries)if(!equal(a.get(id),b.get(id))) {
                if(a.containsKey(id))changed.add(a.get(id).getString("namespaceId"));if(b.containsKey(id))changed.add(b.get(id).getString("namespaceId"));
            }
        }
        return new JSONArray(changed);
    }
    public synchronized JSONObject update(String expected,JSONObject input) throws IOException {
        validate(input);
        byte[] bytes=(input.toString(2)+"\n").getBytes(StandardCharsets.UTF_8);
        if(bytes.length>MAX_BYTES)throw new ApiException(413,"HBDS configuration exceeds 2 MiB.");
        if(expected==null||expected.isBlank())throw new ApiException(428,"Send the HBDS ETag in If-Match before editing.");
        Files.createDirectories(file.getParent());
        Path lockPath=file.resolveSibling(file.getFileName()+".lock");
        if(Files.isSymbolicLink(file)||Files.isSymbolicLink(file.getParent())||Files.isSymbolicLink(lockPath))throw new IOException("HBDS storage cannot be a symbolic link.");
        try(FileChannel channel=FileChannel.open(lockPath,StandardOpenOption.CREATE,StandardOpenOption.WRITE);FileLock ignored=channel.lock()) {
            String disk=Files.exists(file)?digest(readBytes(file)):revision;
            if(!expected.equals("\""+disk+"\"")||!expected.equals(etag()))throw new ApiException(412,"HBDS configuration changed. Reload and reconcile your draft before saving.");
            JSONArray changed=changedNamespaces(document,input),restartReasons=restartReasons(input);
            Path temporary=Files.createTempFile(file.getParent(),"hbds-",".tmp");
            try {
                try(FileChannel target=FileChannel.open(temporary,StandardOpenOption.WRITE)) {
                    ByteBuffer buffer=ByteBuffer.wrap(bytes);while(buffer.hasRemaining())target.write(buffer);target.force(true);
                }
                TimelineAtomicFiles.replace(temporary,file);
            } finally{Files.deleteIfExists(temporary);}
            document=copy(input);revision=digest(bytes);stamp();
            return read().put("changedNamespaceIds",changed).put("restartRequired",!restartReasons.isEmpty()).put("restartReasons",restartReasons);
        }
    }
    public synchronized JSONObject publicConfiguration(String namespaceId) {
        refresh();
        if(namespaceId==null||namespaceId.isBlank())namespaceId=document.getString("defaultNamespaceId");
        JSONObject namespace=index(document,"namespaces").get(namespaceId);
        if(namespace==null)throw new ApiException(404,"HBDS namespace not found.");
        JSONObject model=index(document,"models").get(namespace.getString("modelId"));
        List<JSONObject> tabs=new ArrayList<>();for(Object item:document.getJSONArray("tabs"))if(((JSONObject)item).getBoolean("enabled"))tabs.add((JSONObject)item);
        tabs.sort(Comparator.comparingInt(item->item.getInt("order")));
        return new JSONObject().put("revision",revision).put("namespaceId",namespaceId).put("tabs",new JSONArray(new JSONArray(tabs).toString()))
                .put("namespace",namespace.getString("namespace"))
                .put("modelConfiguration",copy(model.getJSONObject("configuration")));
    }
    public synchronized JSONObject legacyConfiguration() {
        refresh();
        JSONObject result=copy(providerBaseline.getJSONObject("deployment"));JSONArray projected=new JSONArray();
        Map<String,JSONObject> namespaces=index(document,"namespaces"),initial=index(providerBaseline,"namespaces");
        List<JSONObject> sorted=new ArrayList<>();for(Object item:providerBaseline.getJSONArray("sources"))sorted.add((JSONObject)item);
        sorted.sort(Comparator.comparingInt(item->item.getInt("order")));
        for(JSONObject source:sorted) {
            String namespaceId=source.getString("namespaceId");JSONObject namespace=namespaces.getOrDefault(namespaceId,initial.get(namespaceId));
            JSONObject config=copy(source.getJSONObject("configuration"));
            for(String field:List.of("render","filter")) {
                JSONObject defaults=namespace.getJSONObject(field);
                if(field.equals("filter")&&(filePatterns(defaults)||filePatterns(initial.get(namespaceId).getJSONObject(field))))defaults=initial.get(namespaceId).getJSONObject(field);
                JSONObject inherited=copy(defaults);JSONObject override=config.optJSONObject(field);
                if(override!=null)for(String key:override.keySet())inherited.put(key,override.get(key));config.put(field,inherited);
            }
            config.put("namespace",initial.get(namespaceId).getString("namespace"));if(!config.has("enable"))config.put("enable",true);
            if(!config.has("connector")) {
                Map<String,JSONObject> entries=index(providerBaseline,"connectors");List<String> selected=new ArrayList<>();
                for(Object id:initial.get(namespaceId).getJSONArray("connectorIds")) {JSONObject entry=entries.get(id);selected.add(entry.getString("protocol")+":"+entry.getInt("port"));}
                config.put("connector",String.join("|",selected));
            }
            Object connectors=config.opt("connector");if(connectors instanceof JSONArray values)config.put("connector",String.join("|",values.toList().stream().map(Object::toString).toList()));
            // Ingestion paths are independent of the materialized data_model used by the server.
            // Preserve the list, including [], without duplicating a serving source.
            projected.put(config);
        }
        return result.put("data_sources",projected);
    }
    public synchronized JSONObject providerSnapshot() {refresh();return new JSONObject().put("configuration",legacyConfiguration()).put("revision",revision);}
    private static boolean filePatterns(JSONObject filter) {return filter.opt("include") instanceof JSONArray||filter.opt("exclude") instanceof JSONArray;}
    private JSONArray restartReasons(JSONObject next) {
        JSONArray reasons=new JSONArray();for(String key:List.of("sources","connectors","deployment"))if(!equal(providerBaseline.get(key),next.get(key)))reasons.put(key);
        Map<String,JSONObject> original=index(providerBaseline,"namespaces"),updated=index(next,"namespaces");
        boolean bindings=!original.keySet().equals(updated.keySet()),fileFilters=false;
        for(String id:original.keySet())if(updated.containsKey(id)) {
            JSONObject a=original.get(id),b=updated.get(id);bindings|=!a.getString("namespace").equals(b.getString("namespace"))||!equal(a.getJSONArray("connectorIds"),b.getJSONArray("connectorIds"));
            fileFilters|=!equal(a.getJSONObject("filter"),b.getJSONObject("filter"))&&(filePatterns(a.getJSONObject("filter"))||filePatterns(b.getJSONObject("filter")));
        }
        if(bindings)reasons.put("namespaceBindings");if(fileFilters)reasons.put("namespaceFileFilters");return reasons;
    }
}
