import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Schema } from "effect";

const root = join(import.meta.dirname, "../..");

const read = (path: string): string => readFileSync(join(root, path), "utf8");

const filesUnder = (dir: string): ReadonlyArray<string> =>
  readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();

const PackageJson = Schema.Struct({
  name: Schema.String,
  exports: Schema.Record(Schema.String, Schema.String),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const decodePackageJson = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));

const workspaceNames = (deps: Readonly<Record<string, string>> | undefined) =>
  Object.keys(deps ?? {}).filter((dep) => dep.startsWith("@oligarchy/"));

// Each workspace package with the specifiers its exports answer (`./api` is
// `@oligarchy/http/api`) and the workspace packages its dependencies and devDependencies name.
const workspacePackages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name: dir }) => {
    const { name, exports, dependencies, devDependencies } = decodePackageJson(
      read(`packages/${dir}/package.json`),
    );
    return {
      dir: `packages/${dir}`,
      name,
      modules: Object.keys(exports).map((key) => `${name}${key.slice(1)}`),
      dependsOn: workspaceNames(dependencies),
      devDependsOn: workspaceNames(devDependencies),
    };
  });

// The package graph: each package and the workspace packages it depends on.
type PackageGraph = ReadonlyMap<string, ReadonlyArray<string>>;
const packageGraph: PackageGraph = new Map(
  workspacePackages.map((pkg) => [pkg.name, pkg.dependsOn]),
);
const devPackageGraph: PackageGraph = new Map(
  workspacePackages.map((pkg) => [pkg.name, pkg.devDependsOn]),
);

// testing's fakes sit above the apps that use them: nothing may depend on it, only dev-depend.
const TOP = 7;

// The layer each package sits on, numbered as in monorepo-plan.md's picture (shared 0, log 1,
// env 2, db and linear 3, jobs and observability 4, http and fleet 5, the apps 6, the dev-only
// testing on top). A package's dependencies name only packages on a strictly lower layer, so the
// graph reads one way and a loop cannot hide in it. A package joins the list in the phase that
// creates it.
const LAYERS: Readonly<Record<string, number>> = {
  "@oligarchy/shared": 0,
  "@oligarchy/log": 1,
  "@oligarchy/env": 2,
  "@oligarchy/db": 3,
  "@oligarchy/linear": 3,
  "@oligarchy/jobs": 4,
  "@oligarchy/observability": 4,
  "@oligarchy/fleet": 5,
  "@oligarchy/http": 5,
  "@oligarchy/testing": TOP,
};

// A package's sources reach another package only through a dependency its package.json names,
// and their own package by relative path: a bare `@oligarchy/<self>/...` resolves by walking up
// to the root's install, the borrow the isolated linker is there to refuse, and tsc and Bun both
// let it pass.
const packageImportProblems = (
  pkg: { readonly name: string; readonly dependsOn: ReadonlyArray<string> },
  source: string,
): ReadonlyArray<string> =>
  importSpecifiers(source).flatMap((specifier) => {
    if (!specifier.startsWith("@oligarchy/")) {
      return [];
    }
    const imported = specifier.split("/").slice(0, 2).join("/");
    if (imported === pkg.name) {
      return [`"${specifier}" is its own package; import it by relative path`];
    }
    return pkg.dependsOn.includes(imported)
      ? []
      : [`"${specifier}" is not a dependency of ${pkg.name}`];
  });

// A package outside the list, and an edge that does not go strictly downward, each named.
const layerProblems = (
  graph: PackageGraph,
  layers: Readonly<Record<string, number>>,
): ReadonlyArray<string> =>
  [...graph].flatMap(([name, deps]) => {
    const from = layers[name];
    if (from === undefined) {
      return [`${name} is not in the layer list`];
    }
    return deps.flatMap((dep) => {
      const to = layers[dep];
      if (to === undefined) {
        return [`${name} -> ${dep}: ${dep} is not in the layer list`];
      }
      if (to === from) {
        return [`${name} -> ${dep} is a same-layer edge (layer ${String(from)})`];
      }
      return to > from
        ? [`${name} -> ${dep} is an upward edge (layer ${String(from)} -> ${String(to)})`]
        : [];
    });
  });

// Every package a package's dependencies reach, however far down.
const reachable = (graph: PackageGraph, from: string): ReadonlySet<string> => {
  const seen = new Set<string>();
  const visit = (name: string): void => {
    for (const dep of graph.get(name) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        visit(dep);
      }
    }
  };
  visit(from);
  return seen;
};

// A dev edge is not layered (an app's tests may take testing's fakes), but it may not loop back:
// a package dev-depends on another only if that one's dependencies never reach it. So a fake of
// db's own store stays in db's test/, never in a testing that db's tests would import.
const devEdgeProblems = (graph: PackageGraph, devGraph: PackageGraph): ReadonlyArray<string> =>
  [...devGraph].flatMap(([name, devDeps]) =>
    devDeps
      .filter((dep) => reachable(graph, dep).has(name))
      .map((dep) => `${name} -dev-> ${dep} loops back: ${dep} depends on ${name}`),
  );

// The viz's Solid components are `.tsx`; the same rules bind them, and every workspace package's.
const sources = (): ReadonlyArray<string> =>
  ["src", ...workspacePackages.map((pkg) => `${pkg.dir}/src`)]
    .flatMap(filesUnder)
    .filter((path) => !path.startsWith("src/dashboard/"));

const SHARED_SOURCES = "packages/shared/src/";
const LOG_SOURCES = "packages/log/src/";
const LINEAR_SOURCES = "packages/linear/src/";
const JOBS_SOURCES = "packages/jobs/src/";
const HTTP_SOURCES = "packages/http/src/";
// The contract every client bundles: what the wire carries, and nothing that serves or calls it.
const CONTRACT_FILES: ReadonlyArray<string> = ["api.ts", "contract.ts", "errors.ts"].map(
  (file) => `${HTTP_SOURCES}${file}`,
);

const importSpecifiers = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/^import\s(?:[^;]*?\sfrom\s+)?"([^"]+)";?$/gm)].map((m) => m[1] ?? "");

// A low package imports Effect, the packages it is allowed and its own modules, and reads no
// process.*: nothing of the processes, no platform, no Node, no terminal. The boundary rule
// below says the same of process.* for every non-boundary file; here it is named per package.
const confinedImportProblems =
  (dir: string, allowed: RegExp) =>
  (path: string, source: string): ReadonlyArray<string> => [
    ...importSpecifiers(source).filter((specifier) =>
      specifier.startsWith(".")
        ? !join(dirname(path), specifier).startsWith(dir)
        : !allowed.test(specifier),
    ),
    ...[...stripStringsAndComments(source).matchAll(/\bprocess\.\w+/g)].map((m) => m[0]),
  ];

const EFFECT_ONLY = /^effect(?:\/|$)/;
const EFFECT_AND_SHARED = /^(?:effect(?:\/|$)|@oligarchy\/shared\/)/;

// shared is the vocabulary every process speaks, so it knows no other package.
const sharedImportProblems = confinedImportProblems(SHARED_SOURCES, EFFECT_ONLY);

// log is how a failure and a line read as text and the service that writes a line to the console:
// it knows shared's vocabulary and nothing of the terminal (node:tty), the database, the
// row-writing layer or Sentry, so every package above it may take it.
const logImportProblems = confinedImportProblems(LOG_SOURCES, EFFECT_AND_SHARED);

// linear is the Linear API and the names the board uses: it knows a ticket identifier, never a
// result, so it takes the packages below it (shared, log, env) and no store, template or rule
// about what a column means for a job.
const linearImportProblems = confinedImportProblems(
  LINEAR_SOURCES,
  /^(?:effect(?:\/|$)|@oligarchy\/(?:shared|log|env)\/)/,
);

// jobs is the workflow over a result and its ticket: the stores and Linear below it, never the HTTP
// contract, a platform or an app. Dispatching an action to a client stays in automation-server.
const jobsImportProblems = confinedImportProblems(
  JOBS_SOURCES,
  /^(?:effect(?:\/|$)|@oligarchy\/(?:shared|log|env|db|linear)\/)/,
);

// The contract files are the HTTP contract alone: Effect's schemas, the shared vocabularies its
// bodies carry, and each other. The rest of http serves and calls it, and may take Node, the
// platform, env and log; a contract file reaching one of those siblings would bundle them too.
const contractImportProblems = (path: string, source: string): ReadonlyArray<string> => [
  ...confinedImportProblems(HTTP_SOURCES, EFFECT_AND_SHARED)(path, source),
  ...importSpecifiers(source).filter(
    (specifier) =>
      specifier.startsWith(".") &&
      join(dirname(path), specifier).startsWith(HTTP_SOURCES) &&
      !CONTRACT_FILES.includes(join(dirname(path), specifier)),
  ),
];

// The main package imports a workspace package the way it imports its own modules, as a
// namespace, and only by a specifier the package exports: a relative path into packages/ would
// skip the exports map and the dependency the package.json declares.
const exportedModules = new Set(workspacePackages.flatMap((pkg) => pkg.modules));
const workspaceImportProblems = (path: string, source: string): ReadonlyArray<string> =>
  [...source.matchAll(/^import\s+(?:type\s+)?([^;]*?)\s+from\s+"([^"]+)";?$/gm)].flatMap((m) => {
    const clause = m[1] ?? "";
    const specifier = m[2] ?? "";
    if (specifier.startsWith(".")) {
      return join(dirname(path), specifier).startsWith("packages/")
        ? [`"${specifier}" reaches into packages/`]
        : [];
    }
    if (!specifier.startsWith("@oligarchy/")) {
      return [];
    }
    if (!exportedModules.has(specifier)) {
      return [`"${specifier}" is not an exported module`];
    }
    return /^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(clause)
      ? []
      : [`import ${clause} from "${specifier}"`];
  });

// V2-PLAN §1: the only files allowed to import `node:*`, read `process.*`, or use
// `setTimeout`/`new Promise`/`async`.
const BOUNDARY_FILES = new Set([
  "src/qmp/socket.ts",
  "src/qemu-server/main.ts",
  "src/session/readline.ts",
  "src/qemu/qemu.ts",
  // The host's cpu times and memory, read from node:os.
  "packages/fleet/src/host.ts",
  // This process's own cpu and pid, and which host it is on: macOS has no /proc to read them.
  "packages/fleet/src/process.ts",
  "packages/observability/src/instrument.ts",
  // Whether stdout takes colour: the tty's depth and FORCE_COLOR, decided once for the process.
  "packages/env/src/colors.ts",
  // The entry runner: the one NodeRuntime.runMain, the stdout and stderr error listeners.
  "packages/env/src/run.ts",
  // The one node:http server every process listens on, and its error listener.
  "packages/http/src/serve.ts",
  "packages/db/src/client.ts",
]);

const isBoundary = (path: string): boolean =>
  BOUNDARY_FILES.has(path) || /^src\/[^/]+\/main\.ts$/.test(path);

// Non-boundary files allowed exactly one node:* import. Effect's Crypto.digest is one-shot, so a
// multi-gigabyte ISO is hashed with node:crypto's streaming createHash; Effect has no inflate, so
// a PNG's deflate stream is opened with node:zlib. Linear signs the raw webhook body with
// HMAC-SHA256, which Effect's digest does not compute. The client tool's description is client.md,
// read once, so the harness does not keep a second copy of the client's commands.
const NODE_IMPORT_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["src/qemu/iso.ts", "node:crypto"],
  ["src/session/image.ts", "node:zlib"],
  ["src/automation-server/signature.ts", "node:crypto"],
  ["src/harness/tools.ts", "node:fs"],
  // The custom harness driving prompt is read once, the same way client.md is.
  ["src/driver/prompt.ts", "node:fs"],
]);

// Files allowed to call `Effect.run*`, each with the calls it may make.
const RUN_ALLOWED: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ["packages/db/src/client.ts", ["runForkWith", "runPromiseExitWith"]],
]);

const stripStringsAndComments = (source: string): string =>
  source
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const violationsIn = (
  files: ReadonlyArray<string>,
  predicate: (path: string, source: string) => ReadonlyArray<string>,
): ReadonlyArray<string> =>
  files.flatMap((path) => predicate(path, read(path)).map((detail) => `${path}: ${detail}`));

const violations = (
  predicate: (path: string, source: string) => ReadonlyArray<string>,
): ReadonlyArray<string> => violationsIn(sources(), predicate);

describe("boundary files", () => {
  it("only named boundary files import node:* modules", () => {
    expect(
      violations((path, source) =>
        isBoundary(path)
          ? []
          : [...source.matchAll(/from\s+"(node:[^"]+)"/g)]
              .map((m) => m[1] ?? "")
              .filter((module) => NODE_IMPORT_EXCEPTIONS.get(path) !== module),
      ),
    ).toEqual([]);
  });

  it("only boundary files read process.*", () => {
    expect(
      violations((path, source) =>
        isBoundary(path)
          ? []
          : [...stripStringsAndComments(source).matchAll(/\bprocess\.\w+/g)].map((m) => m[0]),
      ),
    ).toEqual([]);
  });

  it("only boundary files use timers, raw promises or async functions", () => {
    expect(
      violations((path, source) =>
        isBoundary(path)
          ? []
          : [
              ...stripStringsAndComments(source).matchAll(
                /\bsetTimeout\s*\(|\bsetInterval\s*\(|\bnew\s+Promise\b|\basync\s+(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/g,
              ),
            ].map((m) => m[0].trim()),
      ),
    ).toEqual([]);
  });

  it("the boundary and exception lists name files that exist", () => {
    for (const path of [
      ...BOUNDARY_FILES,
      ...NODE_IMPORT_EXCEPTIONS.keys(),
      ...RUN_ALLOWED.keys(),
    ]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });
});

describe("Effect.run placement", () => {
  it("appears only in main.ts and the three named files", () => {
    expect(
      violations((path, source) => {
        if (/^src\/[^/]+\/main\.ts$/.test(path)) {
          return [];
        }
        const calls = [...stripStringsAndComments(source).matchAll(/\bEffect\.(run\w+)/g)].map(
          (m) => m[1] ?? "",
        );
        const allowed = RUN_ALLOWED.get(path) ?? [];
        return calls.filter((call) => !allowed.includes(call)).map((call) => `Effect.${call}`);
      }),
    ).toEqual([]);
  });

  // Every entry runs through the one runner, `bun run db:migrate`'s (the db package's) included; the session REPL
  // answers its own signals, so it is the one process with a runtime of its own. Exact lists, so
  // an entry that stops using the runner, or a second runner, is named.
  it("NodeRuntime.runMain lives in env's runner, Runtime.makeRunMain in the session entry, and Env.run in every other entry", () => {
    const calling = (pattern: RegExp): ReadonlyArray<string> =>
      sources().filter((path) => pattern.test(stripStringsAndComments(read(path))));
    expect(calling(/\bNodeRuntime\.runMain\b/)).toEqual(["packages/env/src/run.ts"]);
    expect(calling(/\bRuntime\.makeRunMain\b/)).toEqual(["src/session/main.ts"]);
    expect(calling(/\bEnv\.run\(/)).toEqual([
      "src/automation-client/main.ts",
      "src/automation-server/main.ts",
      "src/client/main.ts",
      "src/ctrl/main.ts",
      "src/driver/main.ts",
      "src/qemu-reverse-proxy/main.ts",
      "src/qemu-server/main.ts",
      "src/viz/main.ts",
      "packages/db/src/migrate.ts",
    ]);
  });

  it("never runs an effect through ManagedRuntime or runSync outside main", () => {
    expect(
      violations((path, source) =>
        /^src\/[^/]+\/main\.ts$/.test(path)
          ? []
          : [
              ...stripStringsAndComments(source).matchAll(
                /\bManagedRuntime\.|\bEffect\.runSync\b/g,
              ),
            ].map((m) => m[0]),
      ),
    ).toEqual([]);
  });
});

describe("CLI flags", () => {
  it("every command accepts --env-file", () => {
    expect(
      violations((path, source) =>
        path.endsWith("/command.ts") && !source.includes("EnvFile.withEnvFile")
          ? ["missing EnvFile.withEnvFile"]
          : [],
      ),
    ).toEqual([]);
  });

  it("every Flag.boolean carries Flag.withDefault", () => {
    expect(
      violations((_, source) => {
        const out: Array<string> = [];
        const declarations = source.split(
          /(?=\bFlag\.(?:boolean|string|integer|float|choice|choiceWithValue)\()/,
        );
        for (const declaration of declarations) {
          if (
            declaration.startsWith("Flag.boolean(") &&
            !declaration.includes("Flag.withDefault(")
          ) {
            out.push(declaration.slice(0, declaration.indexOf(")") + 1));
          }
        }
        return out;
      }),
    ).toEqual([]);
  });
});

describe("HttpApi ownership", () => {
  it("endpoints, groups and the api are declared only in packages/http/src/api.ts", () => {
    expect(
      violations((path, source) =>
        path === `${HTTP_SOURCES}api.ts`
          ? []
          : [
              ...stripStringsAndComments(source).matchAll(
                /\bHttpApiEndpoint\.|\bHttpApiGroup\.make\b|\bHttpApi\.make\b/g,
              ),
            ].map((m) => m[0]),
      ),
    ).toEqual([]);
  });
});

describe("workspace packages", () => {
  it("the shared package imports only effect and its own modules, and reads no process.* (happy)", () => {
    expect(filesUnder(SHARED_SOURCES).length).toBeGreaterThan(0);
    expect(violationsIn(filesUnder(SHARED_SOURCES), sharedImportProblems)).toEqual([]);
  });

  it("names a shared import of Node, a platform, another package or the main package, and a process.* read (unhappy)", () => {
    expect(
      sharedImportProblems(
        `${SHARED_SOURCES}domain.ts`,
        [
          'import { Schema } from "effect";',
          'import * as Errors from "./errors.ts";',
          'import { readFileSync } from "node:fs";',
          'import * as NodeServices from "@effect/platform-node/NodeServices";',
          'import * as Contract from "@oligarchy/http/contract";',
          'import * as Log from "../../../src/shared/errors.ts";',
          "const home = process.env.HOME;",
          'const tag = "process.env in a string is not a read";',
        ].join("\n"),
      ),
    ).toEqual([
      "node:fs",
      "@effect/platform-node/NodeServices",
      "@oligarchy/http/contract",
      "../../../src/shared/errors.ts",
      "process.env",
    ]);
  });

  it("the log package imports only effect, shared and its own modules, and reads no process.* (happy)", () => {
    expect(filesUnder(LOG_SOURCES).length).toBeGreaterThan(0);
    expect(violationsIn(filesUnder(LOG_SOURCES), logImportProblems)).toEqual([]);
  });

  it("names a log import of node:tty, a platform, the database, the row-writing layer or Sentry, and a process.* read (unhappy)", () => {
    expect(
      logImportProblems(
        `${LOG_SOURCES}render.ts`,
        [
          'import { Cause, Console, Effect } from "effect";',
          'import * as CliError from "effect/unstable/cli/CliError";',
          'import type * as Domain from "@oligarchy/shared/domain";',
          'import * as ExternalFailure from "./external-failure.ts";',
          'import { WriteStream } from "node:tty";',
          'import * as NodeServices from "@effect/platform-node/NodeServices";',
          'import * as Logs from "@oligarchy/db/logs";',
          'import * as Observability from "@oligarchy/observability/log";',
          'import * as Sentry from "@sentry/bun";',
          "export const stdoutColors = wantsColor(process.stdout, process.env);",
        ].join("\n"),
      ),
    ).toEqual([
      "node:tty",
      "@effect/platform-node/NodeServices",
      "@oligarchy/db/logs",
      "@oligarchy/observability/log",
      "@sentry/bun",
      "process.stdout",
      "process.env",
    ]);
  });

  it("the linear package imports only effect, shared, log, env and its own modules, and reads no process.* (happy)", () => {
    expect(filesUnder(LINEAR_SOURCES).length).toBeGreaterThan(0);
    expect(violationsIn(filesUnder(LINEAR_SOURCES), linearImportProblems)).toEqual([]);
  });

  it("names a linear import of a store, a template, a test helper or the main package, and a process.* read (unhappy)", () => {
    expect(
      linearImportProblems(
        `${LINEAR_SOURCES}client.ts`,
        [
          'import { Effect, Layer } from "effect";',
          'import * as HttpClient from "effect/unstable/http/HttpClient";',
          'import * as Config from "@oligarchy/env/config";',
          'import * as Errors from "./errors.ts";',
          'import * as Tests from "@oligarchy/db/tests";',
          'import * as Prompts from "../../../src/ctrl/prompts.ts";',
          'import * as Stores from "../test/stores.ts";',
          "const url = process.env.LINEAR_API_URL ?? Config.DEFAULT_LINEAR_API_URL;",
        ].join("\n"),
      ),
    ).toEqual([
      "@oligarchy/db/tests",
      "../../../src/ctrl/prompts.ts",
      "../test/stores.ts",
      "process.env",
    ]);
  });

  it("the jobs package imports only effect, the packages below it and its own modules, and reads no process.* (happy)", () => {
    expect(filesUnder(JOBS_SOURCES).length).toBeGreaterThan(0);
    expect(violationsIn(filesUnder(JOBS_SOURCES), jobsImportProblems)).toEqual([]);
  });

  it("names a jobs import of the automation client, the HTTP contract, a platform or an app, and a process.* read (unhappy)", () => {
    expect(
      jobsImportProblems(
        `${JOBS_SOURCES}abort.ts`,
        [
          'import { Effect } from "effect";',
          'import * as Tests from "@oligarchy/db/tests";',
          'import * as Linear from "@oligarchy/linear/client";',
          'import * as Close from "./close.ts";',
          'import * as AutomationClient from "../../../src/automation-server/client.ts";',
          'import * as Api from "@oligarchy/http/api";',
          'import * as NodeServices from "@effect/platform-node/NodeServices";',
          'import * as Observability from "@oligarchy/observability/log";',
          "const url = process.env.AUTOMATION_SERVER_URL;",
        ].join("\n"),
      ),
    ).toEqual([
      "../../../src/automation-server/client.ts",
      "@oligarchy/http/api",
      "@effect/platform-node/NodeServices",
      "@oligarchy/observability/log",
      "process.env",
    ]);
  });

  it("the contract files import only effect, shared and each other (happy)", () => {
    expect(CONTRACT_FILES.every((path) => filesUnder(HTTP_SOURCES).includes(path))).toBe(true);
    expect(violationsIn(CONTRACT_FILES, contractImportProblems)).toEqual([]);
  });

  it("names a contract import of Node, a platform, log, a serving sibling or the main package (unhappy)", () => {
    expect(
      contractImportProblems(
        `${HTTP_SOURCES}contract.ts`,
        [
          'import { Schema } from "effect";',
          'import * as HttpApi from "effect/unstable/httpapi/HttpApi";',
          'import * as Domain from "@oligarchy/shared/domain";',
          'import * as Errors from "./errors.ts";',
          'import * as Log from "../../../src/shared/errors.ts";',
          'import * as NodeServices from "@effect/platform-node/NodeServices";',
          'import { readFileSync } from "node:fs";',
          'import * as Render from "@oligarchy/log/render";',
          'import * as Serve from "./serve.ts";',
          'import "../test/setup.ts";',
        ].join("\n"),
      ),
    ).toEqual([
      "../../../src/shared/errors.ts",
      "@effect/platform-node/NodeServices",
      "node:fs",
      "@oligarchy/log/render",
      "../test/setup.ts",
      "./serve.ts",
    ]);
  });

  it("the main package imports a workspace package as a namespace of an exported module (happy)", () => {
    expect(exportedModules.size).toBeGreaterThan(0);
    expect(
      violationsIn([...filesUnder("src"), ...filesUnder("test")], workspaceImportProblems),
    ).toEqual([]);
  });

  it("every package's sources import only the packages it declares, and itself by relative path (happy)", () => {
    expect(
      workspacePackages.flatMap((pkg) =>
        violationsIn(filesUnder(`${pkg.dir}/src`), (_, source) =>
          packageImportProblems(pkg, source),
        ),
      ),
    ).toEqual([]);
  });

  it("names a package importing itself by name, and one importing a package it does not declare (unhappy)", () => {
    expect(
      packageImportProblems(
        { name: "@oligarchy/db", dependsOn: ["@oligarchy/env", "@oligarchy/log"] },
        [
          'import { Effect } from "effect";',
          'import * as Errors from "./errors.ts";',
          'import * as Render from "@oligarchy/log/render";',
          'import * as DbErrors from "@oligarchy/db/errors";',
          'import * as Api from "@oligarchy/http/api";',
        ].join("\n"),
      ),
    ).toEqual([
      '"@oligarchy/db/errors" is its own package; import it by relative path',
      '"@oligarchy/http/api" is not a dependency of @oligarchy/db',
    ]);
  });

  it("every package is in the layer list and depends only on strictly lower layers (happy)", () => {
    expect(packageGraph.size).toBeGreaterThan(0);
    expect(layerProblems(packageGraph, LAYERS)).toEqual([]);
  });

  it("every dev edge points at a package whose dependencies never reach back (happy)", () => {
    expect(devPackageGraph.get("@oligarchy/jobs")).toContain("@oligarchy/testing");
    expect(devEdgeProblems(packageGraph, devPackageGraph)).toEqual([]);
  });

  it("names a dependency on the dev-only testing, and a dev edge onto testing from a package it fakes (unhappy)", () => {
    const graph = new Map([
      ["@oligarchy/shared", []],
      ["@oligarchy/db", ["@oligarchy/shared"]],
      ["@oligarchy/linear", []],
      ["@oligarchy/jobs", ["@oligarchy/db", "@oligarchy/testing"]],
      ["@oligarchy/testing", ["@oligarchy/db", "@oligarchy/linear"]],
    ]);
    expect(
      layerProblems(graph, {
        "@oligarchy/shared": 0,
        "@oligarchy/db": 3,
        "@oligarchy/linear": 3,
        "@oligarchy/jobs": 4,
        "@oligarchy/testing": TOP,
      }),
    ).toEqual(["@oligarchy/jobs -> @oligarchy/testing is an upward edge (layer 4 -> 7)"]);
    expect(
      devEdgeProblems(
        graph,
        new Map([
          ["@oligarchy/shared", ["@oligarchy/testing"]],
          ["@oligarchy/linear", ["@oligarchy/testing"]],
          ["@oligarchy/jobs", ["@oligarchy/testing"]],
        ]),
      ),
    ).toEqual([
      "@oligarchy/shared -dev-> @oligarchy/testing loops back: @oligarchy/testing depends on @oligarchy/shared",
      "@oligarchy/linear -dev-> @oligarchy/testing loops back: @oligarchy/testing depends on @oligarchy/linear",
    ]);
  });

  // A loop among listed packages is always an upward or a same-layer edge, so this one check
  // names any loop too: the two-package loop below is named through both of its edges.
  it("names an upward edge, a same-layer edge, a two-package loop and a package missing from the list (unhappy)", () => {
    const layers = {
      "@oligarchy/shared": 0,
      "@oligarchy/log": 1,
      "@oligarchy/env": 2,
      "@oligarchy/db": 3,
      "@oligarchy/linear": 3,
    };
    expect(
      layerProblems(
        new Map([
          ["@oligarchy/shared", []],
          ["@oligarchy/log", ["@oligarchy/shared", "@oligarchy/jobs"]],
          ["@oligarchy/env", ["@oligarchy/log", "@oligarchy/db"]],
          ["@oligarchy/db", ["@oligarchy/env", "@oligarchy/linear"]],
          ["@oligarchy/linear", ["@oligarchy/db"]],
          ["@oligarchy/jobs", []],
        ]),
        layers,
      ),
    ).toEqual([
      "@oligarchy/log -> @oligarchy/jobs: @oligarchy/jobs is not in the layer list",
      "@oligarchy/env -> @oligarchy/db is an upward edge (layer 2 -> 3)",
      "@oligarchy/db -> @oligarchy/linear is a same-layer edge (layer 3)",
      "@oligarchy/linear -> @oligarchy/db is a same-layer edge (layer 3)",
      "@oligarchy/jobs is not in the layer list",
    ]);
  });

  it("names a relative path into packages/, a named import and an unexported module (unhappy)", () => {
    expect(
      workspaceImportProblems(
        "src/client/actions.ts",
        [
          'import * as Api from "@oligarchy/http/api";',
          'import type * as Contract from "@oligarchy/http/contract";',
          'import * as Errors from "../shared/errors.ts";',
          'import * as Errors from "../../packages/http/src/errors.ts";',
          'import { QemuServerApi } from "@oligarchy/http/api";',
          'import * as Http from "@oligarchy/http";',
          'import * as Source from "@oligarchy/http/src/api.ts";',
        ].join("\n"),
      ),
    ).toEqual([
      '"../../packages/http/src/errors.ts" reaches into packages/',
      'import { QemuServerApi } from "@oligarchy/http/api"',
      '"@oligarchy/http" is not an exported module',
      '"@oligarchy/http/src/api.ts" is not an exported module',
    ]);
  });
});

describe("module conventions", () => {
  it("every relative import is a namespace import with a .ts or .tsx extension", () => {
    expect(
      violations((_, source) =>
        [
          ...source.matchAll(/^import\s+(?:type\s+)?([^;]*?)\s+from\s+"(\.{1,2}\/[^"]+)";?$/gm),
        ].flatMap((m) => {
          const clause = m[1] ?? "";
          const specifier = m[2] ?? "";
          const problems: Array<string> = [];
          if (!/^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(clause)) {
            problems.push(`import ${clause} from "${specifier}"`);
          }
          if (!/\.tsx?$/.test(specifier)) {
            problems.push(`"${specifier}" lacks .ts`);
          }
          return problems;
        }),
      ),
    ).toEqual([]);
  });

  // A `.tsx` under src/ is a Solid component file for OpenTUI, so it names that JSX runtime for
  // the type checker; without the pragma tsc would check it against the dashboard's hono/jsx.
  it("every .tsx outside the dashboard opens with the @opentui/solid jsxImportSource pragma", () => {
    expect(
      violations((path, source) =>
        path.endsWith(".tsx") && !source.startsWith("/** @jsxImportSource @opentui/solid */\n")
          ? ["missing /** @jsxImportSource @opentui/solid */"]
          : [],
      ),
    ).toEqual([]);
  });

  // An unstable barrel loads every module of its group: `effect/unstable/httpapi` brings the
  // Scalar docs page, `@effect/platform-node` brings the redis client, msgpackr and the mime
  // table, and a CLI paid for all of it on every call. The module path loads the module alone.
  it("imports Effect core from the barrel and unstable and platform modules as namespaces by module path", () => {
    expect(
      violations((_, source) =>
        [
          ...source.matchAll(
            /import\s+(?:type\s+)?([^;]*?)\s+from\s+"((?:effect|@effect\/platform-node)(?:\/[^"]+)?)"/g,
          ),
        ].flatMap((m) => {
          const clause = m[1] ?? "";
          const specifier = m[2] ?? "";
          if (specifier === "effect") {
            return [];
          }
          if (!/^(?:effect\/unstable\/[a-z]+|@effect\/platform-node)\/[A-Z]\w+$/.test(specifier)) {
            return [specifier];
          }
          return /^\*\s+as\s+[A-Za-z_$][\w$]*$/.test(clause)
            ? []
            : [`import ${clause} from "${specifier}"`];
        }),
      ),
    ).toEqual([]);
  });

  it("uses no `as` assertion other than `as const`", () => {
    expect(
      violations((_, source) => {
        const code = stripStringsAndComments(source)
          .replace(/^\s*import\b[^;]*;/gm, "")
          .replace(/^\s*export\s+(?:\*|\{)[^;]*;/gm, "");
        return [...code.matchAll(/\bas\s+(?!const\b)([A-Za-z_$][\w$.<>[\]]*)/g)].map(
          (m) => `as ${m[1]}`,
        );
      }),
    ).toEqual([]);
  });

  it("every schema class, error and service identifier starts with @oligarchy/", () => {
    expect(
      violations((_, source) =>
        [
          ...source.matchAll(
            /\b(?:Schema\.(?:Class|TaggedError|TaggedClass|Error)|Context\.Service|HttpApiMiddleware\.Service|Context\.Reference)(?:<[^()]*?>)?\(\)?\s*\(?\s*"([^"]+)"/g,
          ),
        ]
          .map((m) => m[1] ?? "")
          .filter((identifier) => !identifier.startsWith("@oligarchy/")),
      ),
    ).toEqual([]);
  });

  it("uses no Data.TaggedError, no class named Error and no barrel re-exports", () => {
    expect(
      violations((_, source) =>
        [
          ...stripStringsAndComments(source).matchAll(
            /\bData\.TaggedError\b|\bclass\s+Error\b|^export\s+\*\s+from\b|^export\s+\{[^}]*\}\s+from\b/gm,
          ),
        ].map((m) => m[0]),
      ),
    ).toEqual([]);
  });
});
