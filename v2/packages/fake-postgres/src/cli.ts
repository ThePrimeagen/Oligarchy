import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import * as FakePostgres from "./main.ts";

const PORT = 5433;

const started = await FakePostgres.start({ port: PORT });
if (!started.ok) {
  process.stderr.write(`${started.error.message}\n`);
  process.exit(1);
}
const fake = started.value;
process.stdout.write(
  `fake-postgres: listening; point a program at it with\nDATABASE_URL=${fake.url}\n`,
);

const app = new App.App({}, {});
app.onExit(() => fake.stop());
await app.main(async (running) => {
  await new Promise<void>((resolve) => {
    running.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  return jarl.ok(undefined);
});
