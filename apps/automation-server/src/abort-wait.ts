import { Clock, Effect, Fiber, Schedule, Stdio, Stream } from "effect";
import * as Errors from "./errors.ts";

// Ten seconds, and the same braille frames viz turns. A client that never answers must not
// hold the process, and the wait is on screen so the ten seconds are visible.
export const TIMEOUT = "10 seconds";
const TIMEOUT_MS = 10_000;
const SPIN_MS = 80;

export const SPINNER: ReadonlyArray<string> = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const glyphAt = (elapsedMs: number, stepMs: number): string =>
  SPINNER[Math.floor(elapsedMs / stepMs) % SPINNER.length] ?? "⠋";

const leftSeconds = (elapsedMs: number): number =>
  Math.max(0, Math.ceil((TIMEOUT_MS - elapsedMs) / 1000));

// `⠋ Aborting <client> ... 10s`, counting down. A terminal rewrites the one line; a pipe
// keeps a line a second.
export const frame = (url: string, elapsedMs: number, stepMs: number): string =>
  `${glyphAt(elapsedMs, stepMs)} Aborting ${url} ... ${String(leftSeconds(elapsedMs))}s`;

const emit = (text: string) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    yield* Stream.run(Stream.make(text), stdio.stdout()).pipe(Effect.ignore);
  });

// Runs `effect` for at most ten seconds. While it waits, stdout shows the spinner and the
// seconds left. The line is cleared when a terminal's wait ends.
export const within = <A, E, R>(url: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const terminal = yield* (yield* Stdio.Stdio).stdoutIsTerminal;
    const stepMs = terminal ? SPIN_MS : 1000;
    const started = yield* Clock.currentTimeMillis;
    const paint = Effect.gen(function* () {
      const elapsed = Math.max(0, (yield* Clock.currentTimeMillis) - started);
      const text = frame(url, elapsed, stepMs);
      yield* emit(terminal ? `\r${text}\x1b[K` : `${text}\n`);
    });
    const ticking = yield* paint.pipe(
      Effect.repeat(Schedule.spaced(terminal ? "80 millis" : "1 second")),
      Effect.forkChild({ startImmediately: true, uninterruptible: false }),
    );
    return yield* effect.pipe(
      Effect.timeoutOrElse({
        duration: TIMEOUT,
        orElse: () =>
          Errors.AutomationClientError.make({
            message: `automation client: POST ${url}/abort failed: no answer within ${TIMEOUT}`,
          }),
      }),
      Effect.ensuring(
        Fiber.interrupt(ticking).pipe(Effect.andThen(terminal ? emit("\r\x1b[K") : Effect.void)),
      ),
    );
  });
