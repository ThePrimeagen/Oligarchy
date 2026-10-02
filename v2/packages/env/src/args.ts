import { homedir } from "node:os";
import * as z from "zod";

// Every flag any oligarchy program takes, declared once. A flag's export is named for its key and
// its key is its spelling: `maxJobs` is `--max-jobs`. Where one spelling means different things
// in different commands, each meaning has an export of its own and the command keys it by the
// spelling: `name: machineName()`. ctrl is a service apps use, not a program, so it has none.

export type Flag<S extends z.ZodType = z.ZodType, R extends boolean = boolean> = {
  // Decodes the text. A bare `--flag` is "true" and must decode to a boolean.
  readonly schema: S;
  readonly description: string;
  // Read when argv does not set the flag.
  readonly env?: string;
  // Absent from argv and its variable, a required flag refuses the command line; one that is not
  // required is what its schema makes of nothing: `.default(x)` is x, anything else undefined.
  readonly required: R;
};

// Required unless called with false. `required` stays the literal it was given, so the type of the
// value a command receives can follow it.
const flag = <S extends z.ZodType>(declared: {
  readonly schema: S;
  readonly description: string;
  readonly env?: string;
}) => {
  function make(required?: true): Flag<S, true>;
  function make(required: false): Flag<S, false>;
  function make(required = true): Flag<S> {
    return { ...declared, required };
  }
  return make;
};

// The tokenizer never hands over an empty value; the rule is here so the schema says what it takes.
const words = z.string().min(1, "must not be empty");
const httpUrl = z.url({ protocol: /^https?$/, error: "must be an http or https url" });
const number = z.coerce.number({ error: "must be a number" });
const atLeastOne = number.int("must be a whole number").min(1, "must be at least 1");
const toggle = z.stringbool({ error: "must be true or false" }).default(false);

// ---------------------------------------------------------------------------
// Every program
// ---------------------------------------------------------------------------

export const envFile = flag({
  schema: words,
  description: "Also read this env file: the process environment wins, then this file, then .env",
});

// No default: where the qemu reverse proxy listens is the operator's knowledge of the fleet. Used
// exactly as given: it is stored on the test suite.
export const serverUrl = flag({
  schema: httpUrl,
  description: "The qemu reverse proxy the calls go to; SERVER_URL when omitted",
  env: "SERVER_URL",
});

// ---------------------------------------------------------------------------
// The servers: qemu-server, qemu-reverse-proxy, automation-server, automation-client
// ---------------------------------------------------------------------------

// No default: each server listens on its own, and two on one host must not collide.
export const port = flag({
  schema: number
    .int("must be a whole number")
    .min(1, "must be 1..65535")
    .max(65535, "must be 1..65535"),
  description: "Listen port",
});

// No default: the fleet knows this machine by the name the operator gave it.
export const machineName = flag({
  schema: words,
  description: "Name this machine on the fleet and on each process reading",
});

// No default: the address something reaches this machine at is nothing it can see. Without one it
// announces nothing and stays out of the fleet.
export const url = flag({
  schema: httpUrl,
  description:
    "Announce this machine to the fleet under this url, every 30 seconds, and delete the row on shutdown",
});

// No default: how many jobs a host carries is the operator's knowledge of that host.
export const maxJobs = flag({
  schema: atLeastOne,
  description: "How many jobs this machine runs at once; a reserve past it is refused with 503",
});

export const display = flag({
  schema: z.enum(["none", "gtk", "sdl", "egl-headless", "spice-app", "dbus"]),
  description: "QEMU display backend for every session; none captures without showing a window",
});

// Not --display: that spelling is the backend. Given here, it must reach QEMU as DISPLAY, or the
// host check passes and the gtk window still has nowhere to open.
export const xDisplay = flag({
  schema: z.string().regex(/:\d+(\.\d+)?$/, "must be an X display like :0"),
  description: "X display --display gtk opens its window on; DISPLAY when omitted",
  env: "DISPLAY",
});

export const automation = flag({
  schema: toggle,
  description: "Force the automation QEMU profile for every session",
});

// Several servers on one machine each keep their own by pointing this elsewhere.
export const dataDir = flag({
  schema: words.default(`${homedir()}/.oligarchy`),
  description:
    "Where this server keeps its iso cache and setup disks; OLIGARCHY_DATA_DIR when omitted, else ~/.oligarchy",
  env: "OLIGARCHY_DATA_DIR",
});

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

export const action = flag({
  schema: z.enum(["drive", "setup"]),
  description: "drive or setup; the model is that action's in oligarchy.json",
});

export const prompt = flag({ schema: words, description: "The user prompt" });

export const debugLog = flag({
  schema: words,
  description: "File that receives one JSON line per step",
});
