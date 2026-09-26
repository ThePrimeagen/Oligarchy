import { homedir } from "node:os";
import * as z from "zod";

// Every flag any oligarchy program takes, declared once. A flag's export is named for its key and
// its key is its spelling: `sessionId` is `--session-id`. Where one spelling means different things
// in different commands, each meaning has an export of its own and the command keys it by the
// spelling: `name: machineName()`, `status: stopStatus(false)`.

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
// A share of the screenshot's width or height from its top-left corner.
const fraction = number.min(0, "must be in 0..1").max(1, "must be in 0..1");
const toggle = z.stringbool({ error: "must be true or false" }).default(false);
const errorTypeKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "must be snake_case: a-z, 0-9 and _, starting with a letter");

// ---------------------------------------------------------------------------
// Every program
// ---------------------------------------------------------------------------

export const envFile = flag({
  schema: words,
  description: "Also read this env file: the process environment wins, then this file, then .env",
});

// Used exactly as given: it is stored on a run and written into its tickets.
export const serverUrl = flag({
  schema: httpUrl.default("http://127.0.0.1:42069"),
  description: "QEMU server the call goes to; SERVER_URL when omitted",
  env: "SERVER_URL",
});

export const agentId = flag({
  schema: words,
  description: "The calling agent's id: the Linear ticket it works",
});

// A shell exports the id once: `SESSION_ID=$(./ctrl session --search ...)`.
export const sessionId = flag({
  schema: words,
  description: "Session id; SESSION_ID when omitted",
  env: "SESSION_ID",
});

export const testResultId = flag({
  schema: words,
  description: "Test result id from the Linear ticket",
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

export const automation = flag({
  schema: toggle,
  description: "Force the automation QEMU profile for every session",
});

// Several servers on one machine each keep their own by pointing this elsewhere.
export const dataDir = flag({
  schema: words.default(`${homedir()}/.oligarchy`),
  description:
    "Where this server keeps its iso cache and minted disks; OLIGARCHY_DATA_DIR when omitted, else ~/.oligarchy",
  env: "OLIGARCHY_DATA_DIR",
});

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------

export const action = flag({
  schema: z.enum(["drive", "mint"]),
  description: "drive or mint; the model is that action's in oligarchy.json",
});

export const prompt = flag({ schema: words, description: "The user prompt" });

export const debugLog = flag({
  schema: words,
  description: "File that receives one JSON line per step",
});

// ---------------------------------------------------------------------------
// client, and the session REPL that runs it
// ---------------------------------------------------------------------------

export const iso = flag({
  schema: words.default("omarchy.iso"),
  description: "ISO path or http(s) url",
});

export const disk = flag({
  schema: words,
  description: "Existing qcow2 path; omit for a fresh disk",
});

export const server = flag({
  schema: httpUrl,
  description: "Reserve on this qemu server (its registered url) instead of the best-ranked one",
});

export const resume = flag({
  schema: toggle,
  description:
    "Boot the machine's minted disk of this iso instead of the iso; refused when there is none",
});

export const output = flag({
  schema: words,
  description: "Write it to this file instead of stdout",
});

export const keys = flag({
  schema: words,
  description: 'Key string to type, e.g. "hello<ENTER>"',
});

// The one encoding the qemu server reads.
export const encoding = flag({
  schema: z.enum(["oligarchy"]).default("oligarchy"),
  description: "Key string encoding",
});

export const x = flag({
  schema: fraction,
  description: "Fraction of the screenshot from the left, 0..1",
});

export const y = flag({
  schema: fraction,
  description: "Fraction of the screenshot from the top, 0..1",
});

export const fromX = flag({
  schema: fraction,
  description: "Where the button goes down, fraction from the left, 0..1",
});

export const fromY = flag({
  schema: fraction,
  description: "Where the button goes down, fraction from the top, 0..1",
});

export const toX = flag({
  schema: fraction,
  description: "Where the button comes up, fraction from the left, 0..1",
});

export const toY = flag({
  schema: fraction,
  description: "Where the button comes up, fraction from the top, 0..1",
});

export const button = flag({
  schema: z.enum(["left", "middle", "right"]).default("left"),
  description: "left, middle or right; left when omitted",
});

// One flag holds them all, because a repeated flag keeps only its last value.
export const modifier = flag({
  schema: z
    .string()
    .transform((text) => text.split(","))
    .pipe(z.array(z.enum(["shift", "ctrl", "alt", "super"])).max(4))
    .default([]),
  description: "Hold these keys around the gesture, comma separated: shift,ctrl",
});

export const direction = flag({
  schema: z.enum(["up", "down", "left", "right"]),
  description: "Which way the wheel turns",
});

export const ticks = flag({
  schema: number
    .int("must be a whole number")
    .min(1, "must be in 1..100")
    .max(100, "must be in 1..100")
    .default(1),
  description: "How many wheel clicks, 1..100; 1 when omitted",
});

export const message = flag({ schema: words, description: "What you are about to do" });

// client stop's --status.
export const stopStatus = flag({
  schema: z.enum(["succeeded", "failed", "aborted", "completed"]),
  description: "Verdict; omit to abort",
});

export const reason = flag({ schema: words, description: "Why the verdict is what it is" });

export const imageId = flag({
  schema: words,
  description: "Image id, as ctrl session --images prints it",
});

// ---------------------------------------------------------------------------
// ctrl
// ---------------------------------------------------------------------------

export const list = flag({ schema: toggle, description: "List what this command keeps" });

export const details = flag({ schema: toggle, description: "Print every field as JSON" });

export const history = flag({
  schema: toggle,
  description: "Print every wording of each definition, oldest first",
});

// ctrl test's --name.
export const definitionName = flag({ schema: words, description: "Test definition name" });

// ctrl test define's --description.
export const testDescription = flag({ schema: words, description: "What the test is about" });

export const instruction = flag({ schema: words, description: "What the driver does" });

export const proof = flag({
  schema: words,
  description: "What must be on screen for the test to pass",
});

// ctrl's --iso: every server downloads it, so it is an https url and never a path.
export const isoUrl = flag({
  schema: z.url({ protocol: /^https$/, error: "must be an https url" }),
  description: "HTTPS URL of the ISO",
});

export const version = flag({
  schema: words,
  description: "Version label attached to every Linear ticket",
});

export const unminted = flag({
  schema: toggle,
  description:
    "Ticket only the live qemu servers that do not hold the ISO's minted disk, asking the reverse proxy at --server-url; needs OLIGARCHY_TOKEN",
});

export const model = flag({ schema: words, description: "Cursor model id doing the work" });

export const id = flag({ schema: words, description: "Test result id" });

// ctrl test-results' --status, recorded as passed or failed.
export const resultStatus = flag({
  schema: z
    .enum(["success", "failed"])
    .transform((status): "passed" | "failed" => (status === "success" ? "passed" : "failed")),
  description: "Whether the test succeeded",
});

export const count = flag({
  schema: atLeastOne.default(10),
  description: "How many of the most recent to print",
});

export const active = flag({
  schema: toggle,
  description: "Print only active sessions, running before downloads",
});

export const json = flag({ schema: toggle, description: "Print as a JSON array" });

export const search = flag({
  schema: toggle,
  description: "Print the id of the session that ran --test-result-id",
});

// ctrl session's --status.
export const sessionStatus = flag({
  schema: toggle,
  description: "Print the session row: how it ended, why, and what it booted",
});

export const logs = flag({ schema: toggle, description: "Print session logs" });

export const testDef = flag({ schema: toggle, description: "Print the session's test definition" });

export const testResults = flag({ schema: toggle, description: "Print the session's test result" });

export const testRun = flag({
  schema: toggle,
  description: "Print the test run the session's result belongs to",
});

export const actions = flag({ schema: toggle, description: "Print session actions" });

export const images = flag({
  schema: toggle,
  description: "Print the session's screenshots: id, action, url, when",
});

export const debugLogs = flag({
  schema: toggle,
  description: "Print the session's debug log (serial, proxy, qemu, actions), saved when it ended",
});

export const diagnosis = flag({
  schema: toggle,
  description: "Print the session's post-run diagnosis, written by diagnose",
});

export const all = flag({
  schema: toggle,
  description:
    "Print the session, logs, test result, definition and run, actions, images, debug log, and diagnosis",
});

export const key = flag({
  schema: errorTypeKey,
  description: "snake_case key the diagnoses of this type carry",
});

// ctrl error-type new's --description.
export const errorTypeDescription = flag({
  schema: words,
  description: "What a failure of this type looks like",
});

export const verdict = flag({
  schema: z.enum(["passed", "failed"]),
  description: "Whether the proof landed, as the evidence shows it",
});

export const type = flag({
  schema: errorTypeKey,
  description: "Error type key of a failed verdict; error-type list prints them",
});

export const summary = flag({
  schema: words,
  description: "What happened, read from the evidence",
});
