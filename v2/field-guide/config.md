# Timeouts and limits

Every timeout, grace, interval and limit an app runs on lives in `v2/oligarchy.json`, read by
`Env.Config.load` (`packages/env/src/config.ts`). No default: a missing key refuses to start.

| Section | Holds |
| --- | --- |
| `httpTimeout` | any HTTP call that names no deadline of its own |
| `fleet` | `heartbeatInterval`: announcements and process-stat sampling (15 seconds) |
| `qemuServer` | `forgetAfter`: runner expiry (45 seconds); `forgetInterval`: expiry checks (30 seconds) |
| `driver` | `runCeiling`, `stepLimit`, `askTimeout`; `harness` (`defaultRetry`, `recentActions`); `guest` (`startTimeout`, `saveTimeout`, `sendKeysTimeout`) |
| `diagnose` | opencode's `runCeiling`, and its stream's `headerTimeout` and `chunkTimeout` |
| `automationClient` | `driverGrace` past `driver.runCeiling`, `killGrace`, `stderrGrace`, `reserveTimeout`, `reservationTimeout` |
| `automationServer` | `dispatchInterval`, `forgetInterval`, `forgetAfter`, `abortTimeout` |

- A duration is a string, `"3 minutes"`. The program sees milliseconds.
- A service takes its timeout as a create option (`timeoutMs`, `reserveTimeoutMs`, `abortTimeoutMs`). It never exports a constant for it.
- `services.ts` or `application.ts` reads the config and hands the value in. Pick only the sections a function needs: `Pick<Env.Config, "httpTimeout">` (`services.ts`).
- A rule between two keys goes in the schema's `superRefine`, naming the key that is wrong: a wait shorter than its ceiling, `abortTimeout` longer than what a client's abort waits.
- A new key adds no test of its own (AGENTS.md rule 3). A new rule between keys gets one refusal test.

| Left in code | Why |
| --- | --- |
| `RUN_TIMEOUT_MS` (`2 ** 31 - 1`) | "no deadline": only an abort ends `/run` |
| OpenRouter `ATTEMPTS` | a count, not a time |
| stores' live window (45 s) | automation-client availability filter in SQL (`packages/stores/src/servers.ts`) |

## Tests

- Give each timeout a distinct value, so a test fails when the wrong key is read (`apps/automation-client/test/run.test.ts`).
- Pass the value in from the test, not from the checked-in file. A test's support module may export the number it passes (`START_TIMEOUT_MS` in `packages/qemu-http-tools/test/support.ts`).

```ts
// apps/automation-client/src/application.ts
Proxy.create({
  http,
  url: flags.serverUrl,
  token: vars.oligarchyToken,
  reserveTimeoutMs: config.automationClient.reserveTimeout,
}),
```

QEMU app configuration lives in `qemuServer` (placement, forwarding, setup/fleet intervals) and
`qemuRunner` (guest lifecycle, cache, QMP, process and input limits). The schema checks nested
operation deadlines. Setup code passes the chosen values into service options.

Runner expiry is checked on each sweep after `forgetAfter` without a heartbeat. The sweep
interval controls detection delay; it does not extend the heartbeat deadline. Announcement
and process-stat services receive `fleet.heartbeatInterval` from application wiring.
