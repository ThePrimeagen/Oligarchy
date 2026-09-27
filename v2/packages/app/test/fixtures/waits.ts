import * as jarl from "jarl";
import * as App from "../../src/main.ts";

// A program that waits for a signal on the real process: main returns once app.signal aborts, and
// its one exit handler prints which signal ended it. With --hang, that handler never returns.
const hang = process.argv.includes("--hang");

// Nothing else keeps the process up while it waits: a signal listener does not.
setInterval(() => undefined, 60_000);

const app = new App.App({}, {});
app.onExit(async (reason) => {
  process.stdout.write(`handler ${reason.kind === "signal" ? reason.signal : reason.kind}\n`);
  if (hang) {
    await new Promise<never>(() => undefined);
  }
});
await app.main(async (started) => {
  process.stdout.write("ready\n");
  await new Promise<void>((resolve) => {
    started.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return jarl.ok(undefined);
});
