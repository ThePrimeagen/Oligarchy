# The cloud client

The interface contract for `src/cloud/client.ts` — a wrapper around the Cursor SDK (`@cursor/sdk`) that drives Cursor cloud agents with three verbs: `createCloud`, `prompt`, `stop`. Written before the implementation; build to this document. No test files, by maintainer instruction (same standing as the CLI — see [Philosophy](philosophy.md)).

A `Cloud` value is one **session**: one cloud agent, one durable server-side conversation, identified by the SDK's `bc-…` agent ID on `cloud.session`. Session IDs are plain strings and survive the process — any process can rejoin one by passing it to `createCloud`.

## The interface

```typescript
import type { SDKAgent } from "@cursor/sdk";

export type CloudOptions = {
  /** Cursor API key. Defaults to the CURSOR_API_KEY environment variable. */
  apiKey?: string;
  /**
   * Model id for the session's prompts. When omitted on a new session the
   * server picks; when omitted on a rejoin the session keeps its previous
   * selection.
   */
  model?: string;
  /** Rejoin this existing session instead of starting a new one. */
  session?: string;
};

export type Cloud = {
  /** The session ID: the SDK's bc-… cloud agent id. */
  readonly session: string;
  readonly options: CloudOptions;
  /** The live SDK handle backing this session. */
  readonly agent: SDKAgent;
};

export type PromptOptions = {
  /** Model id for this prompt. Sticky: later prompts without one keep it. */
  model?: string;
};

/** Starts a new cloud agent session — or rejoins one when options.session is set. */
export function createCloud(options: CloudOptions = {}): Promise<Cloud>;

/** Sends text to the session and resolves with the reply once the run finishes. */
export function prompt(
  cloud: Cloud,
  text: string,
  options?: PromptOptions,
): Promise<string>;

/** Stops the session: cancels its active run, if any, and archives it. */
export function stop(cloud: Cloud): Promise<void>;
```

## What each verb does

| Verb | Cursor SDK calls |
| --- | --- |
| `createCloud`, new session | `Agent.create({ apiKey, model, cloud: {} })` → `session` from `agent.agentId` |
| `createCloud`, rejoin | `Agent.resume(options.session, { apiKey, model })` |
| `prompt` | `agent.send(text, { model })` → `run.wait()` |
| `stop` | `Agent.listRuns(cloud.session, { runtime: "cloud", limit: 1 })`, `run.cancel()` if running, then `Agent.archive(cloud.session, { apiKey })` and `agent.close()` |

### createCloud

- Without `session`: creates a cloud agent with no repository — an empty VM. (No-repo agents must be enabled for the account, and repository-scoped API keys cannot create them.) The session ID is on `cloud.session` immediately; the VM provisions when the first prompt runs, and that run passes through `CREATING` before `RUNNING`.
- With `session`: rejoins the existing session. No network round-trip happens here — a bad or archived ID surfaces on the first `prompt` or `stop`, not at construction.

### prompt

- Blocks until the run finishes and resolves with the final assistant text — empty string when the run produced none. A reply can take minutes; there is no streaming.
- `options.model` follows the SDK's per-send semantics: it overrides for this prompt and sticks for later prompts on the session.
- A session runs one prompt at a time. Prompting a busy session rejects with the SDK's `AgentBusyError`; the wrapper does not queue or auto-cancel.
- A run that ends `error` or `cancelled` rejects with an `Error` carrying the run's error message. `prompt` resolves only with a finished run's text.

### stop

- Cancel first, then archive, so a mid-run agent actually halts. Archiving is the SDK's soft delete: the transcript stays readable in Cursor and the agent can be unarchived from the dashboard.
- Stopping a session you only have the ID of is rejoin-then-stop: `await stop(await createCloud({ session: id }))`.
- Stopping or prompting an already-archived session fails naturally with the SDK's own error (`ConfigurationError`, code `agent_archived`). No idempotency ceremony on top.

## Errors

The wrapper wraps nothing. SDK errors propagate as-is: `AuthenticationError` (bad or missing key), `AgentBusyError` (concurrent prompt), `ConfigurationError` (bad model id, archived session), `NetworkError`. The only error minted here is `prompt` rejecting when a run ends `error` or `cancelled`.

## Example

```typescript
import { createCloud, prompt, stop } from "./src/cloud/client.ts";

const cloud = await createCloud({ model: "composer-2.5" });
console.log(cloud.session); // bc-…

await prompt(cloud, "Research QMP's screendump options and summarize.");
await prompt(cloud, "Now compare with the VNC framebuffer approach.");
await stop(cloud);

// Another process, later: rejoin by ID and continue.
const rejoined = await createCloud({ session: savedSessionId });
await prompt(rejoined, "One more comparison: SPICE.");
await stop(rejoined);
```

## Deliberately not here

Support only what is used:

- **No separate `start` verb.** `createCloud` starts the session (or rejoins one). One constructor, no two-step ceremony — and because rejoining happens at construction, `prompt` needs no `session` option and never starts a session you didn't ask for.
- **No repository option.** Sessions run on empty VMs. If repo-attached agents turn out to be needed, the extension is one optional field (`repo?: string` on `CloudOptions`); it stays out until asked for.
- No streaming, no images, no per-run env vars, no metadata tags, no PR options, no list/inspect verbs, no timeouts.
- Model is a plain id string, not the SDK's `ModelSelection` — no per-model params until something needs them.

## Implementation notes

- One file, `src/cloud/client.ts`, mirroring `src/qemu/client.ts`: an async factory returning a plain state object, standalone functions taking it first. The SDK's `Agent` class is consumed, never subclassed — no classes of our own.
- The live SDK handle rides on `cloud.agent`; `prompt` sends through it and `stop` closes it. One `Agent.create`/`Agent.resume` per `Cloud`, not per call.
- `@cursor/sdk` becomes the repo's first runtime dependency. It requires Node.js 22.13 or later.
