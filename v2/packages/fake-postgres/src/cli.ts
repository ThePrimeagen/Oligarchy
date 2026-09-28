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

const stop = async () => {
  await fake.stop();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
