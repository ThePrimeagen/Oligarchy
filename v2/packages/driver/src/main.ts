import * as Env from "@oligarchy/env";
import * as jarl from "jarl";
import * as App from "./app.ts";

const result = await Env.create(App.app);
if (jarl.error.is(result, Env.HelpRequested)) {
  process.stdout.write(result.error.text);
  process.exit(0);
}
if (jarl.error.is(result, Env.Unexpected)) {
  // A bug, not a refusal: the stack is what finds it.
  console.error(result.error.message, result.error.cause);
  process.exit(1);
}
if (jarl.is_err(result)) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

// The whole env, so what each flag, variable and file did is visible. Secrets print redacted.
process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
