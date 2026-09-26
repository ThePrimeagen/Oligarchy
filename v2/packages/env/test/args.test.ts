import { homedir } from "node:os";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Args from "../src/args.ts";
import * as Env from "../src/main.ts";

type Name = keyof typeof Args;

type Case = {
  readonly text: string;
  readonly value: unknown;
  readonly refused?: { readonly text: string; readonly message: string };
};

const EMPTY = { text: "", message: "must not be empty" };
const NOT_BOOLEAN = { text: "maybe", message: "must be true or false" };
const NOT_URL = { text: "ftp://box-1", message: "must be an http or https url" };
const NOT_FRACTION = "must be in 0..1";
const NOT_SNAKE = "must be snake_case: a-z, 0-9 and _, starting with a letter";

const words = (text: string) => ({ text, value: text, refused: EMPTY });
const toggle = (text: string, value: boolean) => ({ text, value, refused: NOT_BOOLEAN });

// One value every flag takes, and one it refuses wherever its schema has a rule. `satisfies` makes
// a flag added to args.ts without a case here a compile error.
const cases = {
  envFile: words(".prod-env"),
  serverUrl: { text: "http://127.0.0.1:42070", value: "http://127.0.0.1:42070", refused: NOT_URL },
  agentId: words("OLI-12"),
  sessionId: words("5f0c2a4e-6d0b-4b7e-9a51-0f4c3c6f8e21"),
  testResultId: words("tr-7"),

  port: {
    text: "42069",
    value: 42069,
    refused: { text: "70000", message: "must be 1..65535" },
  },
  machineName: words("box-1"),
  url: { text: "https://box-1.tunnel:8443", value: "https://box-1.tunnel:8443", refused: NOT_URL },
  maxJobs: { text: "4", value: 4, refused: { text: "0", message: "must be at least 1" } },
  display: {
    text: "gtk",
    value: "gtk",
    refused: {
      text: "x11",
      message:
        'Invalid option: expected one of "none"|"gtk"|"sdl"|"egl-headless"|"spice-app"|"dbus"',
    },
  },
  automation: toggle("true", true),
  dataDir: words("/srv/oligarchy-2"),

  action: {
    text: "mint",
    value: "mint",
    refused: { text: "diagnose", message: 'Invalid option: expected one of "drive"|"mint"' },
  },
  prompt: words("Log in and lock the screen"),
  debugLog: words("/tmp/steps.jsonl"),

  iso: words("https://example.com/omarchy.iso"),
  disk: words("/tmp/minted.qcow2"),
  server: { text: "http://127.0.0.1:42069", value: "http://127.0.0.1:42069", refused: NOT_URL },
  resume: toggle("false", false),
  output: words("screen.png"),
  keys: words("hello<ENTER>"),
  encoding: {
    text: "oligarchy",
    value: "oligarchy",
    refused: { text: "utf8", message: 'Invalid input: expected "oligarchy"' },
  },
  x: { text: "0.5", value: 0.5, refused: { text: "1.5", message: NOT_FRACTION } },
  y: { text: "0", value: 0, refused: { text: "-0.1", message: NOT_FRACTION } },
  fromX: { text: "0.25", value: 0.25, refused: { text: "2", message: NOT_FRACTION } },
  fromY: { text: "1", value: 1, refused: { text: "-1", message: NOT_FRACTION } },
  toX: { text: "0.75", value: 0.75, refused: { text: "1.01", message: NOT_FRACTION } },
  toY: { text: "0.1", value: 0.1, refused: { text: "left", message: "must be a number" } },
  button: {
    text: "right",
    value: "right",
    refused: { text: "back", message: 'Invalid option: expected one of "left"|"middle"|"right"' },
  },
  modifier: {
    text: "shift,ctrl",
    value: ["shift", "ctrl"],
    refused: {
      text: "shift,meta",
      message: 'Invalid option: expected one of "shift"|"ctrl"|"alt"|"super"',
    },
  },
  direction: {
    text: "down",
    value: "down",
    refused: { text: "in", message: 'Invalid option: expected one of "up"|"down"|"left"|"right"' },
  },
  ticks: { text: "3", value: 3, refused: { text: "101", message: "must be in 1..100" } },
  message: words("Opening the lock screen menu"),
  stopStatus: {
    text: "aborted",
    value: "aborted",
    refused: {
      text: "passed",
      message: 'Invalid option: expected one of "succeeded"|"failed"|"aborted"|"completed"',
    },
  },
  reason: words("The screen froze on the login prompt"),
  imageId: words("8e3c1f0a-2b7d-4c9e-b5a6-3d2f1e0c9b8a"),

  list: toggle("1", true),
  details: toggle("yes", true),
  history: toggle("no", false),
  definitionName: words("lock-screen"),
  testDescription: words("The lock screen appears after the shortcut"),
  instruction: words("Press Super+Escape and choose Lock"),
  proof: words("The lock screen asks for the password"),
  isoUrl: {
    text: "https://example.com/omarchy.iso",
    value: "https://example.com/omarchy.iso",
    refused: { text: "http://example.com/omarchy.iso", message: "must be an https url" },
  },
  version: words("2026.09.1"),
  unminted: toggle("on", true),
  model: words("meta/muse-spark-1.3-contributor"),
  id: words("tr-7"),
  resultStatus: {
    text: "success",
    value: "passed",
    refused: { text: "passed", message: 'Invalid option: expected one of "success"|"failed"' },
  },
  count: { text: "25", value: 25, refused: { text: "2.5", message: "must be a whole number" } },
  active: toggle("off", false),
  json: toggle("true", true),
  search: toggle("true", true),
  sessionStatus: toggle("true", true),
  logs: toggle("true", true),
  testDef: toggle("true", true),
  testResults: toggle("true", true),
  testRun: toggle("true", true),
  actions: toggle("true", true),
  images: toggle("true", true),
  debugLogs: toggle("true", true),
  diagnosis: toggle("true", true),
  all: toggle("true", true),
  key: {
    text: "missed_click",
    value: "missed_click",
    refused: { text: "Missed-Click", message: NOT_SNAKE },
  },
  errorTypeDescription: words("The driver clicked where nothing was"),
  verdict: {
    text: "failed",
    value: "failed",
    refused: { text: "success", message: 'Invalid option: expected one of "passed"|"failed"' },
  },
  type: {
    text: "missed_click",
    value: "missed_click",
    refused: { text: "1st_try", message: NOT_SNAKE },
  },
  summary: words("The lock screen never appeared"),
} satisfies Record<Name, Case>;

// The namespace as a plain record, so a test reaches a flag by its name.
const flags: Readonly<Record<Name, (typeof Args)[Name]>> = Args;
const isName = (key: string): key is Name => Object.hasOwn(cases, key);
const names = Object.keys(cases).filter(isName);
const entries = names.map((name): [Name, Case] => [name, cases[name]]);

// What a flag that is not required is when neither argv nor its variable sets it.
const DEFAULTS = new Map<Name, unknown>([
  ["serverUrl", "http://127.0.0.1:42069"],
  ["dataDir", `${homedir()}/.oligarchy`],
  ["iso", "omarchy.iso"],
  ["encoding", "oligarchy"],
  ["button", "left"],
  ["modifier", []],
  ["ticks", 1],
  ["count", 10],
  ...entries
    .filter(([, each]) => each.refused === NOT_BOOLEAN)
    .map(([name]): [Name, unknown] => [name, false]),
]);

describe("required", () => {
  it("is required when called with nothing (happy)", () => {
    for (const name of names) {
      expect(flags[name]().required, name).toBe(true);
    }
  });

  it("is not required when called with false (happy)", () => {
    for (const name of names) {
      expect(flags[name](false).required, name).toBe(false);
    }
  });

  it("types required as the literal it was given, so the value's type can follow it (happy)", () => {
    expectTypeOf(Args.sessionId().required).toEqualTypeOf<true>();
    expectTypeOf(Args.sessionId(false).required).toEqualTypeOf<false>();
  });

  it("refuses, at compile time, anything but nothing or false (unhappy)", () => {
    const maybe: boolean = names.length > 0;
    // @ts-expect-error a flag is required or not, never a guess
    expect(Args.sessionId(maybe).required).toBe(true);
    // @ts-expect-error false is the only argument
    expect(Args.sessionId("no").required).toBe("no");
  });
});

describe("decode", () => {
  it("has a case for every flag the programs take (happy)", () => {
    expect(Object.keys(Args).sort()).toEqual([...names].sort());
  });

  it.each(entries)("reads %s from its text (happy)", (name, each) => {
    expect(flags[name]().schema.parse(each.text)).toEqual(each.value);
  });

  it.each(entries.filter(([, each]) => each.refused !== undefined))(
    "refuses a bad %s and says why (unhappy)",
    (name, each) => {
      const result = flags[name]().schema.safeParse(each.refused?.text);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe(each.refused?.message);
    },
  );
});

describe("absent", () => {
  it("takes the default its schema names (happy)", () => {
    for (const [name, value] of DEFAULTS) {
      expect(flags[name](false).schema.parse(undefined), name).toEqual(value);
    }
  });

  it("has nothing to stand in without a default, so absent is undefined (unhappy)", () => {
    for (const name of names.filter((each) => !DEFAULTS.has(each))) {
      expect(flags[name](false).schema.safeParse(undefined).success, name).toBe(false);
    }
  });
});

describe("variables", () => {
  const readers = new Map(
    names.flatMap((name): Array<[Name, string]> => {
      const variable = flags[name]().env;
      return variable === undefined ? [] : [[name, variable]];
    }),
  );

  it("falls back to SERVER_URL, SESSION_ID and OLIGARCHY_DATA_DIR (happy)", () => {
    expect(Object.fromEntries(readers)).toEqual({
      serverUrl: "SERVER_URL",
      sessionId: "SESSION_ID",
      dataDir: "OLIGARCHY_DATA_DIR",
    });
  });

  it("reads no variable for any other flag (unhappy)", () => {
    const others = names.filter((name) => !readers.has(name));
    expect(others.length).toBe(names.length - 3);
    for (const name of others) {
      expect(flags[name]().env, name).toBeUndefined();
    }
  });
});

describe("package", () => {
  it("hands out every flag as Env.args (happy)", () => {
    const exported: Readonly<Record<Name, (typeof Args)[Name]>> = Env.args;
    for (const name of names) {
      expect(exported[name], name).toBe(flags[name]);
    }
  });

  it("finds nothing under a flag no program takes (unhappy)", () => {
    expect("verbose" in Env.args).toBe(false);
  });
});
