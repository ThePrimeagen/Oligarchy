import * as Cli from "./cli.ts";

// Flags that fall back to a variable. The variable is environment, so the flag is declared here.

// SERVER_URL="" is unset and the default applies.
export const serverUrl = Cli.string({
  description: "Qemu server the run goes to",
  env: "SERVER_URL",
  default: "http://127.0.0.1:42069",
});
