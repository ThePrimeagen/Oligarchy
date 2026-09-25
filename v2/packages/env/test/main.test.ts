import { readFileSync } from "node:fs";
import * as jarl from "jarl";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Env from "../src/main.ts";

const SENTINEL = "s3cr3t-sentinel-value";
const CONFIG = { [Env.CONFIG_PATH]: readFileSync(Env.CONFIG_PATH, "utf8") };

// Every create reads oligarchy.json, so every fake carries the checked-in one unless a test says otherwise.
const io = (
  options: {
    readonly argv?: ReadonlyArray<string>;
    readonly env?: Readonly<Record<string, string>>;
    readonly files?: Readonly<Record<string, string>>;
    readonly unreadable?: ReadonlyArray<string>;
  } = {},
) => Env.fakeIo({ ...options, files: { ...CONFIG, ...options.files } });

const app = {
  name: "driver",
  description: "Run the harness loop for one prompt",
  flags: {
    agentId: Env.flag.string({ description: "The ticket the run is filed on" }),
    serverUrl: Env.flag.serverUrl,
  },
  needs: ["openRouterToken", "linearTeam", "linearApiUrl"] as const,
};

const SET = { OPENROUTER_API_KEY: SENTINEL, LINEAR_TEAM: "Board" };
const ARGV = ["--agent-id", "OLI-1"];

const linear = {
  name: "linear",
  description: "Reads three plain variables",
  flags: {},
  needs: ["linearTeam", "automationServerUrl", "linearApiUrl"] as const,
};

describe("create", () => {
  it("builds one typed object: the app's flags, the variables it names, oligarchy.json (happy)", async () => {
    const result = await Env.create(app, io({ argv: ARGV, env: SET }));
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    const env = result.value;
    expectTypeOf(env).toEqualTypeOf<{
      flags: { agentId: string; serverUrl: string };
      vars: { openRouterToken: Env.Secret; linearTeam: string; linearApiUrl: string };
      config: Env.Config;
    }>();
    expect(env.flags).toEqual({ agentId: "OLI-1", serverUrl: "http://127.0.0.1:42069" });
    expect(env.vars.openRouterToken.reveal()).toBe(SENTINEL);
    expect(env.vars.linearTeam).toBe("Board");
    expect(env.vars.linearApiUrl).toBe("https://api.linear.app/graphql");
    expect(env.config.models.drive).toMatch(/^[^/]+\/.+$/);
  });

  it("hands an app only the variables it names, so another need not be set (happy)", async () => {
    const teamOnly = { ...linear, needs: ["linearTeam"] as const };
    const env = jarl.unwrap(await Env.create(teamOnly, io({ env: { LINEAR_TEAM: "Board" } })));
    expect(env.vars).toEqual({ linearTeam: "Board" });
  });

  it("never prints a secret, even when the whole env is printed (happy)", async () => {
    const env = jarl.unwrap(await Env.create(app, io({ argv: ARGV, env: SET })));
    expect(JSON.stringify(env)).not.toContain(SENTINEL);
  });

  it("lets the process environment win, then --env-file, then .env (happy)", async () => {
    const result = await Env.create(
      linear,
      io({
        argv: ["--env-file", ".prod-env"],
        env: { LINEAR_TEAM: "env" },
        files: {
          ".prod-env": "LINEAR_TEAM=file\nAUTOMATION_SERVER_URL=file\n",
          ".env": "LINEAR_TEAM=dot\nAUTOMATION_SERVER_URL=dot\nLINEAR_API_URL=dot\n",
        },
      }),
    );
    expect(jarl.unwrap(result).vars).toEqual({
      linearTeam: "env",
      automationServerUrl: "file",
      linearApiUrl: "dot",
    });
  });

  it("reads --env-file=path the same way (happy)", async () => {
    const result = await Env.create(
      linear,
      io({
        argv: ["--env-file=.prod-env"],
        files: { ".prod-env": "LINEAR_TEAM=file\nAUTOMATION_SERVER_URL=file\n" },
      }),
    );
    expect(jarl.unwrap(result).vars).toMatchObject({
      linearTeam: "file",
      automationServerUrl: "file",
    });
  });

  it("lets --server-url fall back to a SERVER_URL only the --env-file has (happy)", async () => {
    const result = await Env.create(
      app,
      io({
        argv: [...ARGV, "--env-file", ".prod-env"],
        env: SET,
        files: { ".prod-env": "SERVER_URL=http://prod:1\n" },
      }),
    );
    expect(jarl.unwrap(result).flags.serverUrl).toBe("http://prod:1");
  });

  it("counts an empty value as unset, so a later source fills it (happy)", async () => {
    const result = await Env.create(
      app,
      io({ argv: ARGV, env: { ...SET, LINEAR_TEAM: "" }, files: { ".env": "LINEAR_TEAM=Dot\n" } }),
    );
    expect(jarl.unwrap(result).vars.linearTeam).toBe("Dot");
  });

  it("reads only the sources an app names (happy)", async () => {
    const fake = io({
      files: {
        "/etc/oligarchy.env": "LINEAR_TEAM=etc\nAUTOMATION_SERVER_URL=etc\n",
        ".env": "LINEAR_TEAM=dot\n",
      },
    });
    const etcOnly = {
      ...linear,
      sources: [Env.source.processEnv, Env.source.file("/etc/oligarchy.env")],
    };
    expect(jarl.unwrap(await Env.create(etcOnly, fake)).vars.linearTeam).toBe("etc");
    expect(fake.reads).not.toContain(".env");
  });

  it("adds a source after the defaults, which still win (happy)", async () => {
    const withEtc = {
      ...linear,
      sources: [...Env.source.defaults, Env.source.file("/etc/oligarchy.env")],
    };
    const result = await Env.create(
      withEtc,
      io({
        env: { LINEAR_TEAM: "env" },
        files: { "/etc/oligarchy.env": "LINEAR_TEAM=etc\nAUTOMATION_SERVER_URL=etc\n" },
      }),
    );
    expect(jarl.unwrap(result).vars).toMatchObject({
      linearTeam: "env",
      automationServerUrl: "etc",
    });
  });

  it("refuses --env-file when no source reads it (unhappy)", async () => {
    const result = await Env.create(
      { ...linear, sources: [Env.source.processEnv] },
      io({ argv: ["--env-file", ".prod-env"] }),
    );
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("unknown flag --env-file");
  });

  it("refuses an --env-file that does not exist (unhappy)", async () => {
    const result = await Env.create(
      app,
      io({ argv: [...ARGV, "--env-file", ".prod-env"], env: SET }),
    );
    if (!jarl.error.is(result, Env.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(result.error.message).toBe(".prod-env: file is missing");
  });

  it("refuses a .env that exists but cannot be read (unhappy)", async () => {
    const result = await Env.create(app, io({ argv: ARGV, env: SET, unreadable: [".env"] }));
    if (!jarl.error.is(result, Env.FileUnreadable)) {
      throw new Error("expected FileUnreadable");
    }
    expect(result.error.message).toMatch(/^\.env: /);
  });

  it("reports the first variable nobody set, in the order the app names them (unhappy)", async () => {
    const none = await Env.create(app, io({ argv: ARGV }));
    if (!jarl.error.is(none, Env.MissingVariable)) {
      throw new Error("expected MissingVariable");
    }
    expect(none.error.message).toBe("OPENROUTER_API_KEY is not set");

    const tokenOnly = await Env.create(
      app,
      io({ argv: ARGV, env: { OPENROUTER_API_KEY: SENTINEL } }),
    );
    if (!jarl.error.is(tokenOnly, Env.MissingVariable)) {
      throw new Error("expected MissingVariable");
    }
    expect(tokenOnly.error.message).toBe("LINEAR_TEAM is not set");
  });

  it("refuses, at compile time, a variable env does not declare (unhappy)", async () => {
    const unknown = { ...linear, needs: ["nope"] as const };
    // @ts-expect-error "nope" is not one of env's variables
    const result = await Env.create(unknown, io());
    expect(jarl.error.is(result, Env.Unexpected)).toBe(true);
  });

  it("refuses a missing oligarchy.json (unhappy)", async () => {
    const result = await Env.create(app, Env.fakeIo({ argv: ARGV, env: SET }));
    if (!jarl.error.is(result, Env.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(result.error.message).toBe(`${Env.CONFIG_PATH}: file is missing`);
  });

  it("reports a broken oligarchy.json before a missing variable (unhappy)", async () => {
    const result = await Env.create(app, io({ argv: ARGV, files: { [Env.CONFIG_PATH]: "{" } }));
    expect(jarl.error.is(result, Env.ConfigInvalid)).toBe(true);
  });

  it("resolves a readFile that throws as Unexpected instead of rejecting (unhappy)", async () => {
    const throwing = {
      ...io({ argv: ARGV, env: SET }),
      readFile: async (): Promise<never> => {
        throw new TypeError("fs exploded");
      },
    };
    const result = await Env.create(app, throwing);
    if (!jarl.error.is(result, Env.Unexpected)) {
      throw new Error("expected Unexpected");
    }
    expect(result.error.message).toBe("unexpected: fs exploded");
  });

  it("reports a usage error before it reads any file (unhappy)", async () => {
    const fake = io({ argv: ["--nope"], unreadable: [".env"] });
    expect(jarl.error.is(await Env.create(app, fake), Env.UsageError)).toBe(true);
    expect(fake.reads).toEqual([]);
  });

  it("asks for help before it reads anything, and the help names every flag (happy)", async () => {
    const fake = io({ argv: ["--help"] });
    const result = await Env.create(app, fake);
    if (!jarl.error.is(result, Env.HelpRequested)) {
      throw new Error("expected HelpRequested");
    }
    expect(fake.reads).toEqual([]);
    for (const expected of ["--env-file", "--agent-id", "--server-url", "SERVER_URL"]) {
      expect(result.error.text).toContain(expected);
    }
  });

  it("asks for help wherever --help appears, even beside a mistake (happy)", async () => {
    const result = await Env.create(app, io({ argv: ["--nope", "--help"] }));
    expect(jarl.error.is(result, Env.HelpRequested)).toBe(true);
  });
});

// A noun then a verb, or a verb alone, each from a fixed list.
const ctrl = {
  name: "ctrl",
  description: "Record and inspect test runs",
  flags: { serverUrl: Env.flag.serverUrl },
  commands: {
    mint: Env.command({ description: "Mint a disk for the server" }),
    test: {
      run: Env.command({
        description: "File a run of one definition",
        flags: {
          name: Env.flag.string({ description: "Definition to run" }),
          suite: Env.flag.boolean({ description: "Run every definition" }),
        },
      }),
      list: Env.command({ description: "Print the backlog" }),
    },
  },
  needs: ["linearTeam"] as const,
};

const TEAM = { LINEAR_TEAM: "Board" };

describe("create with commands", () => {
  it("names the command it ran and types that command's own flags (happy)", async () => {
    const result = await Env.create(
      ctrl,
      io({ argv: ["test", "run", "--name", "lock-screen"], env: TEAM }),
    );
    if (!jarl.is_ok(result)) {
      throw result.error;
    }
    const env = result.value;
    expectTypeOf(env.command).toEqualTypeOf<
      | { name: "mint"; flags: {} }
      | { name: "test run"; flags: { name: string; suite: boolean } }
      | { name: "test list"; flags: {} }
    >();
    expectTypeOf(env.flags).toEqualTypeOf<{ serverUrl: string }>();
    if (env.command.name !== "test run") {
      throw new Error("expected test run");
    }
    expect(env.command.flags).toEqual({ name: "lock-screen", suite: false });
    expect(env.flags.serverUrl).toBe("http://127.0.0.1:42069");
    expect(env.vars.linearTeam).toBe("Board");
  });

  it("runs a verb on its own (happy)", async () => {
    const env = jarl.unwrap(await Env.create(ctrl, io({ argv: ["mint"], env: TEAM })));
    expect(env.command).toEqual({ name: "mint", flags: {} });
  });

  it("refuses a third word: test run testsuite is one operation (unhappy)", async () => {
    const result = await Env.create(ctrl, io({ argv: ["test", "run", "testsuite"], env: TEAM }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("unexpected argument testsuite");
  });

  it("refuses a flag that belongs to another command (unhappy)", async () => {
    const result = await Env.create(ctrl, io({ argv: ["mint", "--name", "x"], env: TEAM }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("unknown flag --name");
  });

  it("names the command's missing required flag (unhappy)", async () => {
    const result = await Env.create(ctrl, io({ argv: ["test", "run"], env: TEAM }));
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("--name is required");
  });

  it("refuses a missing or unknown command before it reads any file (unhappy)", async () => {
    const fake = io({ argv: ["fly"], env: TEAM });
    const result = await Env.create(ctrl, fake);
    if (!jarl.error.is(result, Env.UsageError)) {
      throw new Error("expected UsageError");
    }
    expect(result.error.message).toBe("unknown command fly; expected one of mint, test");
    expect(fake.reads).toEqual([]);
  });

  it("refuses, at compile time, a noun inside a noun (unhappy)", async () => {
    const deep = {
      ...ctrl,
      commands: { test: { run: { suite: Env.command({ description: "Too deep" }) } } },
    };
    // @ts-expect-error a noun holds verbs, never another noun
    const result = await Env.create(deep, io({ argv: ["test", "run", "suite"], env: TEAM }));
    expect(jarl.is_err(result)).toBe(true);
  });

  it("shows help for the level the path reaches (happy)", async () => {
    const top = await Env.create(ctrl, io({ argv: ["--help"] }));
    const noun = await Env.create(ctrl, io({ argv: ["test", "--help"] }));
    const verb = await Env.create(ctrl, io({ argv: ["test", "run", "--help"] }));
    if (
      !jarl.error.is(top, Env.HelpRequested) ||
      !jarl.error.is(noun, Env.HelpRequested) ||
      !jarl.error.is(verb, Env.HelpRequested)
    ) {
      throw new Error("expected HelpRequested");
    }
    expect(top.error.text).toContain("ctrl <command>");
    expect(noun.error.text).toContain("ctrl test <verb>");
    expect(verb.error.text).toContain("--suite");
    expect(verb.error.text).toContain("--server-url");
  });
});
