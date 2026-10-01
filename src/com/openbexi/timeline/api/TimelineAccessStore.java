package com.openbexi.timeline.api;

import org.json.*;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Access, entitlement and document ownership sidecars. Never writes timeline item payloads. */
public final class TimelineAccessStore {
    public record Principal(String id, int serviceRole) {
        public boolean systemAdmin() { return serviceRole == 3; }
        public boolean authenticated() { return !id.equals("anonymous"); }
    }
    private static final Map<Path,Object> LOCKS = new ConcurrentHashMap<>();
    private static final Set<String> PERMISSIONS = Set.of("read", "writeRecords", "writeFilters", "admin");
    private final Path directory, file;
    public TimelineAccessStore(Path storage) throws IOException {
        directory = storage.toAbsolutePath().normalize().resolve(".access"); file = directory.resolve("state.json");
        if (Files.isSymbolicLink(directory) || Files.isSymbolicLink(file)) throw new IOException("Access storage must not be a symbolic link.");
    }
    private JSONObject load() throws IOException {
        if (Files.isSymbolicLink(file)) throw new IOException("Invalid access state file.");
        if (Files.exists(file)) return new JSONObject(Files.readString(file));
        return new JSONObject().put("version",1).put("users",new JSONObject()).put("models",new JSONObject())
                .put("workspaces",new JSONObject().put("default",new JSONObject().put("id","default").put("name","Default workspace")
                        .put("organizationId","default").put("entitlement",defaultEntitlement())));
    }
    private static JSONObject defaultEntitlement() {
        return new JSONObject().put("mode","community").put("status","active").put("eligibilityCategory","none")
                .put("verificationStatus","notRequired").put("features",new JSONObject().put("ai",true)).put("revision","initial");
    }
    @FunctionalInterface private interface Operation<T> { T run(JSONObject state) throws IOException; }
    private <T> T locked(boolean write, Operation<T> operation) throws IOException {
        synchronized (LOCKS.computeIfAbsent(file,k -> new Object())) {
            Files.createDirectories(directory);
            if (Files.isSymbolicLink(directory) || Files.isSymbolicLink(directory.resolve("state.lock"))) throw new IOException("Invalid access storage.");
            try (FileChannel lock = FileChannel.open(directory.resolve("state.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);
                 FileLock ignored = lock.lock()) {
                JSONObject state=load(); T result=operation.run(state);
                if (write) {
                    Path temporary=Files.createTempFile(directory,"access-",".tmp");
                    try {
                        try (FileChannel channel=FileChannel.open(temporary,StandardOpenOption.WRITE)) {
                            ByteBuffer bytes=ByteBuffer.wrap(state.toString().getBytes(StandardCharsets.UTF_8));
                            while(bytes.hasRemaining())channel.write(bytes); channel.force(true);
                        }
                        Files.move(temporary,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
                    } finally {Files.deleteIfExists(temporary);}
                }
                return result;
            }
        }
    }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public Principal authenticate(String bearer) throws IOException {
        String hash=digest(bearer);
        return locked(false,state -> {
            JSONObject users=state.getJSONObject("users");
            for(String id:users.keySet()) {
                JSONObject user=users.getJSONObject(id);
                if(user.optBoolean("enabled",true) && MessageDigest.isEqual(hash.getBytes(StandardCharsets.UTF_8),user.getString("tokenHash").getBytes(StandardCharsets.UTF_8)))
                    return new Principal(id,0);
            }
            throw new ApiException(401,"Invalid API credentials.");
        });
    }
    public JSONObject me(Principal principal) throws IOException {
        return locked(false,state -> {
            JSONObject user=state.getJSONObject("users").optJSONObject(principal.id());
            return new JSONObject().put("id",principal.id()).put("systemAdmin",principal.systemAdmin()).put("serviceRole",principal.serviceRole())
                    .put("workspaceIds",user==null?new JSONArray():user.getJSONArray("workspaceIds"));
        });
    }
    public boolean reservedModelId(String modelId) throws IOException {
        return locked(false,state -> state.getJSONObject("models").has(modelId) || state.optJSONArray("retiredModelIds",new JSONArray()).toList().contains(modelId));
    }
    public void reserveRetiredId(String modelId) throws IOException {
        locked(true,state -> {JSONArray retired=state.optJSONArray("retiredModelIds",new JSONArray());
            if(!retired.toList().contains(modelId))retired.put(modelId);state.put("retiredModelIds",retired);return null;});
    }
    public void inheritModel(String sourceId,String modelId) throws IOException {
        locked(true,state -> {
            JSONObject source=state.getJSONObject("models").optJSONObject(sourceId);
            if(source==null || !source.optBoolean("scoped"))return null;
            if(state.getJSONObject("models").has(modelId) || state.optJSONArray("retiredModelIds",new JSONArray()).toList().contains(modelId))
                throw new ApiException(409,"Model identity is already reserved. Choose a new ID.");
            JSONObject inherited=TimelineRecords.copy(source).put("modelId",modelId).put("datasetId",modelId).put("revision",UUID.randomUUID().toString());
            state.getJSONObject("models").put(modelId,inherited);return null;
        });
    }
    private static void keys(JSONObject input,Set<String> allowed) {
        if(!allowed.containsAll(input.keySet()))throw new ApiException(422,"Unknown access property.");
    }
    private static void strings(JSONObject input,String... names) {
        for(String name:names)if(input.has(name) && !(input.get(name) instanceof String))throw new ApiException(422,name+" must be a string.");
    }
    public JSONObject createUser(JSONObject input) throws IOException {
        keys(input,Set.of("id","displayName","token","workspaceIds"));
        strings(input,"id","displayName","token");
        String id=TimelineRepository.validId(input.optString("id"));
        if(id.equals("anonymous") || id.startsWith("service-"))throw new ApiException(422,"Reserved user identity.");
        String credential=input.optString("token");
        if(credential.isEmpty()){byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);credential=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
        if(credential.length()<32 || credential.length()>512)throw new ApiException(422,"User token must contain 32 to 512 characters.");
        final String token=credential;
        return locked(true,state -> {
            JSONObject users=state.getJSONObject("users");
            if(users.has(id))throw new ApiException(409,"User already exists.");
            JSONArray memberships=input.optJSONArray("workspaceIds");
            if(memberships==null || memberships.isEmpty())throw new ApiException(422,"Provide at least one workspace membership.");
            Set<String> distinct=new HashSet<>();
            for(Object value:memberships)if(!(value instanceof String) || !state.getJSONObject("workspaces").has((String)value) || !distinct.add((String)value))
                throw new ApiException(422,"Workspace memberships must be unique existing workspace IDs.");
            for(String existing:users.keySet())if(users.getJSONObject(existing).getString("tokenHash").equals(digest(token)))throw new ApiException(409,"Credential already belongs to a user.");
            JSONObject user=new JSONObject().put("id",id).put("displayName",input.optString("displayName",id)).put("workspaceIds",memberships)
                    .put("tokenHash",digest(token)).put("enabled",true);
            users.put(id,user);
            JSONObject result=TimelineRecords.copy(user);result.remove("tokenHash");return result.put("token",token);
        });
    }
    public JSONArray users() throws IOException {
        return locked(false,state -> {JSONArray result=new JSONArray();for(String id:state.getJSONObject("users").keySet()){
            JSONObject user=TimelineRecords.copy(state.getJSONObject("users").getJSONObject(id));user.remove("tokenHash");result.put(user);}return result;});
    }
    public JSONArray workspaces() throws IOException {
        return locked(false,state -> {JSONArray result=new JSONArray();for(String id:state.getJSONObject("workspaces").keySet())result.put(state.getJSONObject("workspaces").getJSONObject(id));return result;});
    }
    public JSONObject createWorkspace(JSONObject input) throws IOException {
        keys(input,Set.of("id","name","organizationId"));strings(input,"id","name","organizationId"); String id=TimelineRepository.validId(input.optString("id"));
        return locked(true,state -> {JSONObject workspaces=state.getJSONObject("workspaces");if(workspaces.has(id))throw new ApiException(409,"Workspace already exists.");
            JSONObject value=new JSONObject().put("id",id).put("name",input.optString("name",id)).put("organizationId",TimelineRepository.validId(input.optString("organizationId",id)))
                    .put("entitlement",defaultEntitlement());workspaces.put(id,value);return value;});
    }
    private static JSONObject definition(JSONObject state,String modelId) {
        JSONObject existing=state.getJSONObject("models").optJSONObject(modelId);
        return existing==null?new JSONObject().put("modelId",modelId).put("datasetId",modelId).put("workspaceId","default")
                .put("grants",new JSONArray()).put("roles",new JSONArray()).put("scoped",false).put("revision","legacy"):existing;
    }
    private static int rank(String role){return switch(role){case "admin"->3;case "readWrite"->2;case "readOnly"->1;default->0;};}
    private static JSONObject permissions(int role) {
        return new JSONObject().put("read",role>=1).put("write",role>=2).put("writeRecords",role>=2).put("writeFilters",role>=2).put("admin",role>=3);
    }
    private static JSONObject effective(JSONObject state,Principal principal,JSONObject model) {
        if(principal.systemAdmin())return new JSONObject().put("role","admin").put("permissions",permissions(3));
        if(!model.optBoolean("scoped"))return new JSONObject().put("role",switch(principal.serviceRole()){case 2->"readWrite";case 1->"readOnly";default->"none";})
                .put("permissions",permissions(principal.serviceRole()));
        JSONObject user=state.getJSONObject("users").optJSONObject(principal.id());
        if(user!=null && user.optBoolean("enabled",true) && user.getJSONArray("workspaceIds").toList().contains(model.getString("workspaceId"))) {
            for(Object value:model.getJSONArray("grants")) {
                JSONObject grant=(JSONObject)value;
                if(!grant.getString("userId").equals(principal.id()))continue;
                String name=grant.getString("role");int base=rank(name);JSONObject allowed=permissions(base);
                if(base==0)for(Object entry:model.getJSONArray("roles")) {
                    JSONObject custom=(JSONObject)entry;if(!custom.getString("name").equals(name))continue;
                    allowed=permissions(0);for(Object permission:custom.getJSONArray("permissions"))allowed.put((String)permission,true);
                    allowed.put("write",allowed.getBoolean("writeRecords") || allowed.getBoolean("writeFilters"));
                }
                return new JSONObject().put("role",name).put("permissions",allowed);
            }
        }
        return new JSONObject().put("role","none").put("permissions",permissions(0));
    }
    public JSONObject access(String modelId,Principal principal) throws IOException {
        return locked(false,state -> {JSONObject model=TimelineRecords.copy(definition(state,modelId));JSONObject effective=effective(state,principal,model);
            return model.put("role",effective.get("role")).put("permissions",effective.get("permissions"));});
    }
    public static String etag(JSONObject model){JSONObject value=TimelineRecords.copy(model);value.remove("role");value.remove("permissions");return TimelineRepository.etag(value);}
    public void require(Principal principal,String modelId,String permission) throws IOException {
        if(!access(modelId,principal).getJSONObject("permissions").optBoolean(permission))throw new ApiException(principal.authenticated()?403:401,"This model requires "+permission+" permission.");
    }
    public JSONObject update(String modelId,Principal principal,String expected,JSONObject input) throws IOException {
        keys(input,Set.of("workspaceId","grants","roles"));
        strings(input,"workspaceId");
        if(input.has("roles") && !(input.get("roles") instanceof JSONArray))throw new ApiException(422,"roles must be an array.");
        return locked(true,state -> {
            JSONObject current=definition(state,modelId);
            if(!effective(state,principal,current).getJSONObject("permissions").getBoolean("admin"))throw new ApiException(403,"Model administrator access is required.");
            if(expected==null)throw new ApiException(428,"Send the access ETag in If-Match.");
            if(!etag(current).equals(expected))throw new ApiException(412,"Model access changed. Reload before saving.");
            String workspace=input.optString("workspaceId",current.getString("workspaceId"));
            if(!state.getJSONObject("workspaces").has(workspace))throw new ApiException(422,"Workspace does not exist.");
            if(!workspace.equals(current.getString("workspaceId")) && !principal.systemAdmin())throw new ApiException(403,"Only system administrators may transfer workspace ownership.");
            JSONArray roles=input.optJSONArray("roles",current.getJSONArray("roles")),grants=input.optJSONArray("grants");
            if(grants==null || grants.length()>1000 || roles.length()>50)throw new ApiException(422,"Provide grants and at most 50 custom roles.");
            Set<String> names=new HashSet<>(Set.of("admin","readWrite","readOnly"));
            for(Object entry:roles) {
                if(!(entry instanceof JSONObject custom))throw new ApiException(422,"Invalid role.");
                keys(custom,Set.of("name","permissions"));strings(custom,"name");String name=TimelineRepository.validId(custom.optString("name"));
                JSONArray allowed=custom.optJSONArray("permissions");
                if(!names.add(name) || allowed==null || !allowed.toList().contains("read"))throw new ApiException(422,"Custom roles need a unique name and read permission.");
                Set<Object> distinct=new HashSet<>();for(Object permission:allowed)if(!(permission instanceof String) || !PERMISSIONS.contains(permission) || !distinct.add(permission))throw new ApiException(422,"Unknown or duplicated permission.");
                if(allowed.toList().contains("admin"))throw new ApiException(422,"Use the built-in admin role for administration.");
            }
            Set<String> identities=new HashSet<>();boolean admin=false;
            for(Object entry:grants) {
                if(!(entry instanceof JSONObject grant))throw new ApiException(422,"Invalid grant.");keys(grant,Set.of("userId","role"));strings(grant,"userId","role");
                String userId=grant.optString("userId"),role=grant.optString("role");JSONObject user=state.getJSONObject("users").optJSONObject(userId);
                if(user==null || !user.optBoolean("enabled",true) || !user.getJSONArray("workspaceIds").toList().contains(workspace))throw new ApiException(422,"Every model user must be an active member of its workspace.");
                if(!identities.add(userId) || !names.contains(role))throw new ApiException(422,"Duplicate user or unknown model role.");
                admin|=role.equals("admin");
            }
            if(!admin)throw new ApiException(409,"A model must retain at least one active administrator.");
            JSONObject next=TimelineRecords.copy(current).put("workspaceId",workspace).put("grants",grants).put("roles",roles).put("scoped",true).put("revision",UUID.randomUUID().toString());
            state.getJSONObject("models").put(modelId,next);return next;
        });
    }
    public JSONObject entitlement(String workspace) throws IOException {
        return locked(false,state -> {JSONObject value=state.getJSONObject("workspaces").optJSONObject(workspace);if(value==null)throw new ApiException(404,"Workspace not found.");return value.getJSONObject("entitlement");});
    }
    public JSONObject updateEntitlement(String workspace,String expected,JSONObject input) throws IOException {
        keys(input,Set.of("mode","status","eligibilityCategory","verificationStatus","expiresAt","features"));
        strings(input,"mode","status","eligibilityCategory","verificationStatus","expiresAt");
        if(!Set.of("community","commercial","exempt").contains(input.optString("mode")) || !Set.of("active","suspended","expired").contains(input.optString("status")))throw new ApiException(422,"Invalid entitlement mode or status.");
        if(!Set.of("none","student","researcher","charity","nonprofit","other").contains(input.optString("eligibilityCategory","none")) ||
                !Set.of("notRequired","pending","verified","rejected").contains(input.optString("verificationStatus","notRequired")))throw new ApiException(422,"Invalid eligibility or verification status.");
        if(input.optString("mode").equals("exempt") && (!input.optString("verificationStatus").equals("verified") || input.optString("eligibilityCategory","none").equals("none")))throw new ApiException(422,"Exempt access requires verified eligibility.");
        if(input.has("expiresAt"))try{Instant.parse(input.getString("expiresAt"));}catch(RuntimeException e){throw new ApiException(422,"expiresAt must be an ISO instant.");}
        JSONObject features=input.optJSONObject("features");if(features==null || !Set.of("ai").containsAll(features.keySet()))throw new ApiException(422,"features accepts the ai boolean.");
        for(String key:features.keySet())if(!(features.get(key) instanceof Boolean))throw new ApiException(422,"Feature flags must be booleans.");
        return locked(true,state -> {JSONObject value=state.getJSONObject("workspaces").optJSONObject(workspace);if(value==null)throw new ApiException(404,"Workspace not found.");
            TimelineRepository.requireMatch(expected,value.getJSONObject("entitlement"));JSONObject next=TimelineRecords.copy(input).put("revision",UUID.randomUUID().toString());value.put("entitlement",next);return next;});
    }
    public void requireFeature(String modelId,String feature) throws IOException {
        locked(false,state -> {JSONObject model=definition(state,modelId);JSONObject entitlement=state.getJSONObject("workspaces").getJSONObject(model.getString("workspaceId")).getJSONObject("entitlement");
            if(!entitlement.optString("status").equals("active") || (entitlement.has("expiresAt") && !Instant.parse(entitlement.getString("expiresAt")).isAfter(Instant.now())) || !entitlement.getJSONObject("features").optBoolean(feature))
                throw new ApiException(403,"The workspace entitlement does not enable "+feature+".");return null;});
    }
}
