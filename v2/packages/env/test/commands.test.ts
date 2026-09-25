import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Cli from "../src/cli.ts";
import * as Commands from "../src/commands.ts";
import * as Errors from "../src/errors.ts";

const commands = {
  mint: Commands.command({ description: "Mint a disk for the server" }),
  test: {
    define: Commands.command({
      description: "Define a test",
      flags: { name: Cli.string({ description: "Definition name" }) },
    }),
    run: Commands.command({ description: "File a run of one definition" }),
  },
};

const usage = async (argv: ReadonlyArray<string>): Promise<string> => {
  const result = await Commands.route(argv, commands);
  if (!jarl.error.is(result, Errors.UsageError)) {
    throw new Error("expected UsageError");
  }
  return result.error.message;
};

describe("route", () => {
  it("reads a verb on its own and leaves the flags (happy)", async () => {
    const routed = jarl.unwrap(await Commands.route(["mint", "--x", "1"], commands));
    expect(routed.name).toBe("mint");
    expect(routed.rest).toEqual(["--x", "1"]);
  });

  it("reads a noun then a verb, and carries that verb's flags (happy)", async () => {
    const routed = jarl.unwrap(await Commands.route(["test", "define", "--name", "a"], commands));
    expect(routed.name).toBe("test define");
    expect(Object.keys(routed.flags)).toEqual(["name"]);
    expect(routed.rest).toEqual(["--name", "a"]);
  });

  it("leaves argv alone for an app without commands (happy)", async () => {
    const routed = jarl.unwrap(await Commands.route(["--x", "1"], {}));
    expect(routed.name).toBeUndefined();
    expect(routed.rest).toEqual(["--x", "1"]);
  });

  it("refuses a missing command, and one before its flags (unhappy)", async () => {
    expect(await usage([])).toBe("expected a command: mint, test");
    expect(await usage(["--x", "1", "mint"])).toBe("expected a command: mint, test");
  });

  it("refuses a command it does not know (unhappy)", async () => {
    expect(await usage(["fly"])).toBe("unknown command fly; expected one of mint, test");
    expect(await usage(["toString"])).toBe("unknown command toString; expected one of mint, test");
  });

  it("refuses a noun without its verb (unhappy)", async () => {
    expect(await usage(["test"])).toBe("test needs a verb: define, run");
    expect(await usage(["test", "--name", "a"])).toBe("test needs a verb: define, run");
  });

  it("refuses a verb the noun does not have (unhappy)", async () => {
    expect(await usage(["test", "fly"])).toBe("unknown verb test fly; expected one of define, run");
  });
});

describe("help", () => {
  const shared = { verbose: Cli.boolean({ description: "Print every step" }) };
  const helpFor = (argv: ReadonlyArray<string>) =>
    Commands.help("ctrl", "Record test runs", shared, commands, argv);

  it("lists every command at the top, a noun with its verbs (happy)", () => {
    const text = helpFor(["--help"]);
    for (const expected of [
      "ctrl <command>",
      "mint",
      "Mint a disk for the server",
      "test",
      "define, run",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("lists a noun's verbs with their descriptions (happy)", () => {
    const text = helpFor(["test", "--help"]);
    for (const expected of ["ctrl test <verb>", "define", "Define a test", "run"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("Mint a disk");
  });

  it("lists a command's own flags beside the shared ones (happy)", () => {
    const text = helpFor(["test", "define", "--help"]);
    for (const expected of ["ctrl test define", "--name", "Definition name", "--verbose"]) {
      expect(text).toContain(expected);
    }
  });

  it("falls back to the nearest level it can name when the path is wrong (unhappy)", () => {
    expect(helpFor(["fly", "--help"])).toContain("ctrl <command>");
    expect(helpFor(["test", "fly", "--help"])).toContain("ctrl test <verb>");
  });

  it("lists the flags for an app without commands (happy)", () => {
    expect(Commands.help("driver", "Drive", shared, {}, ["--help"])).toContain("--verbose");
  });
});
