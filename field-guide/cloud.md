# The cloud client

The interface contract for `src/cloud/client.ts` — a wrapper around the Cursor SDK (`@cursor/sdk`) that drives Cursor cloud agents with three verbs: `start`, `prompt`, `stop`. Written before the implementation; build to this document. No test files, by maintainer instruction (same standing as the CLI — see [Philosophy](philosophy.md)).

A **session** is one cloud agent: a durable server-side conversation identified by the SDK's `bc-…` agent ID. Session IDs are plain strings and survive the process — any process holding the ID (and a valid API key) can prompt or stop it. The client keeps no per-session state.

## The interface

```typescript
export type CloudOptions = {
  /** Cursor API key. Defaults to the CURSOR_API_KEY environment variable. */
  apiKey?: string;
  /** Default model id for new sessions. The server picks one when omitted. */
  model?: string;
};

export type Cloud = {
  readonly options: CloudOptions;
};

export type PromptOptions = {
  /** Rejoin this session. When omitted, a new session is started. */
  session?: string;
  /** Model id for this prompt. Sticky: later prompts without one keep it. */
  model?: string;
};

export type PromptResult = {
  /** The session the prompt ran in — the rejoined one, or the newly started one. */
  session: string;
  /** Final assistant text. Empty string when the run produced none. */
  text: string;
};

export function createCloud(options: CloudOptions = {}): Cloud;

/** Starts a new cloud agent session and returns its session ID. */
export function start(cloud: Cloud): Promise<string>;

/** Sends text to a session and resolves with the reply once the run finishes. */
export function prompt(
  cloud: Cloud,
  text: string,
  options?: PromptOptions,
): Promise<PromptResult>;

/** Stops a session: cancels its active run, if any, and archives it. */
export function stop(cloud: Cloud, session: string): Promise<void>;
```

## What each verb does

| Verb | Cursor SDK calls |
| --- | --- |
| `start` | `Agent.create({ apiKey, model, cloud: {} })` → returns `agent.agentId` |
| `prompt` with `session` | `Agent.resume(session, { apiKey })` → `agent.send(text, { model })` → `run.wait()` |
| `prompt` without `session` | `Agent.create(…)`, then the same send-and-wait; the new ID comes back on the result |
| `stop` | `Agent.listRuns(session, { runtime: "cloud", limit: 1 })`, `run.cancel()` if it is running, then `Agent.archive(session, { apiKey })` |

### start

- Creates a cloud agent with no repository — an empty VM. (No-repo agents must be enabled for the account, and repository-scoped API keys cannot create them.)
- Returns the session ID immediately. The VM provisions when the first prompt runs; that first run passes through `CREATING` before `RUNNING`.
- The session's model is the factory default when set, otherwise the server-resolved default.

### prompt

- Blocks until the run finishes. A reply can take minutes; there is no streaming.
- `options.model` follows the SDK's per-send semantics: it overrides for this prompt and sticks for later prompts on the same session.
- A session runs one prompt at a time. Prompting a busy session rejects with the SDK's `AgentBusyError`; the wrapper does not queue or auto-cancel.
- A run that ends `error` or `cancelled` rejects with an `Error` carrying the run's error message. `prompt` resolves only with a finished run's final text.

### stop

- Cancel first, then archive, so a mid-run agent actually halts. Archiving is the SDK's soft delete: the transcript stays readable in Cursor and the agent can be unarchived from the dashboard.
- Stopping or prompting an already-archived session fails naturally with the SDK's own error (`ConfigurationError`, code `agent_archived`). No idempotency ceremony on top.

## Errors

The wrapper wraps nothing. SDK errors propagate as-is: `AuthenticationError` (bad or missing key), `AgentBusyError` (concurrent prompt), `ConfigurationError` (bad model id, archived session), `NetworkError`. The only error minted here is `prompt` rejecting when a run ends `error` or `cancelled`.

## Example

```typescript
import { createCloud, start, prompt, stop } from "./src/cloud/client.ts";

const cloud = createCloud({ model: "composer-2.5" });

const session = await start(cloud);
await prompt(cloud, "Research QMP's screendump options and summarize.", { session });
await prompt(cloud, "Now compare with the VNC framebuffer approach.", { session });
await stop(cloud, session);

// One-off: prompt starts its own session and reports it.
const { session: oneOff, text } = await prompt(cloud, "Name three QEMU display backends.");
await stop(cloud, oneOff);
```

## Deliberately not here

Support only what is used:

- **No repository option.** Sessions run on empty VMs. If repo-attached agents turn out to be needed, the extension is one optional field (`repo?: string` on `CloudOptions`); it stays out until asked for.
- No streaming, no images, no per-run env vars, no metadata tags, no PR options, no list/inspect verbs, no timeouts.
- Model is a plain id string, not the SDK's `ModelSelection` — no per-model params until something needs them.

## Implementation notes

- One file, `src/cloud/client.ts`, mirroring `src/qemu/client.ts`: a factory returning a plain state object, standalone functions taking it first. The SDK's `Agent` class is consumed, never subclassed — no classes of our own.
- `@cursor/sdk` becomes the repo's first runtime dependency. It requires Node.js 22.13 or later.
