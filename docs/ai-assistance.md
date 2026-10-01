# Optional AI assistance

An administrator can ask AI to explain, generate or repair a timeline model, or
use a timeline image as a rendering reference. AI returns a candidate draft.
Review its explanation, assumptions, validation and changes before applying it.
Applying a candidate changes the editor draft; saving remains a separate action.

The normal editor remains usable without AI. Only model configuration JSON and
YAML are eligible. Source, server and deployment YAML remain manual because they
can contain credentials. Event/session items and their metadata are never part
of the AI configuration-editing contract.

## Configure providers

Place the configuration below in `.ai/providers.json` inside the private API data
directory, or set `OPENBEXI_AI_CONFIG` to a regular JSON file outside the web root.
Restart the API server after changing provider configuration.

```json
{
  "enabled": true,
  "maxRequestsPerHour": 20,
  "maxConcurrentRequests": 4,
  "requestTimeoutSeconds": 60,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "adapter": "openai",
      "credentialEnv": "OPENAI_API_KEY",
      "models": [
        {
          "id": "YOUR_AVAILABLE_MODEL_ID",
          "capabilities": {"vision": true, "structuredOutput": true},
          "maxOutputTokens": 4096,
          "maxInputBytes": 262144
        }
      ]
    }
  ]
}
```

Select a model available to your provider account and declare its actual
capabilities. No provider model ID is hard-coded. Provider availability indicates
configured credentials, not a completed account or billing check.

| Adapter | Protocol | Default endpoint |
| --- | --- | --- |
| `openai` | Responses | `https://api.openai.com/v1/responses` |
| `anthropic` | Messages | `https://api.anthropic.com/v1/messages` |
| `huggingface` | Chat Completions through inference providers | `https://router.huggingface.co/v1/chat/completions` |
| `openai-compatible` | Chat Completions | Explicit endpoint |
| `local` | Chat Completions | Explicit local endpoint; credentials optional |

Endpoints require HTTPS, except loopback HTTP for local services. Credentials are
read from the named environment variable on the server. The editor never receives
provider keys, endpoint secrets or credential environment variable names.

Adapters follow the providers' documented image and structured-output formats:
[OpenAI images](https://developers.openai.com/api/docs/guides/images-vision),
[OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs),
[Anthropic vision](https://platform.claude.com/docs/en/build-with-claude/vision),
[Anthropic structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
and [Hugging Face inference](https://huggingface.co/docs/inference-providers/tasks/chat-completion).
Hugging Face model discovery and inference are different services; configure an
inference-capable model. Streaming is currently disabled.

## Review a proposal

Connect to a managed model as an administrator, select the provider and model,
and enter the requested configuration change. For an image reference, select a
vision-capable model and choose a PNG, JPEG, WebP or GIF up to 1 MiB. The panel
identifies the provider and selected input before you submit it.

The server checks access, entitlement, input limits and the returned model schema.
The editor checks the candidate again and shows changes for review. A changed
base draft prevents applying a stale proposal. A failed, cancelled or invalid
request leaves the existing draft intact. Undo restores the preceding draft.
Inferred image details are assumptions, not factual sessions or events.

The authenticated request owner can cancel an in-flight request even after a
model grant or AI entitlement is revoked. Cancellation identifies the exact
model, caller and request; it cannot start a new generation or inspect another
user's request.

Requests and images are not persisted by the AI service. OpenAI requests set
`store:false`; other provider retention policies are controlled by those services.
Request quotas are per authenticated identity, with a concurrency limit for each
server process. These counters are in memory and reset when the server restarts.

Tests use local mock HTTP providers to cover adapter payloads, image handling,
schema validation, cancellation, limits and secret handling. They do not establish
availability or quality for a particular live provider account.
