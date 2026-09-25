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
});
const decodePackageJson = Schema.decodeUnknownSync(Schema.fromJsonString(PackageJson));

// Each workspace package with the specifiers its exports answer (`./api` is
// `@oligarchy/routes/api`) and the workspace packages its dependencies name.
const workspacePackages = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map(({ name: dir }) => {
    const { name, exports, dependencies } = decodePackageJson(read(`packages/${dir}/package.json`));
    return {
      dir: `packages/${dir}`,
      name,
      modules: Object.keys(exports).map((key) => `${name}${key.slice(1)}`),
      dependsOn: Object.keys(dependencies ?? {}).filter((dep) => dep.startsWith("@oligarchy/")),
    };
  });

// The package graph: each package and the workspace packages it depends on.
type PackageGraph = ReadonlyMap<string, ReadonlyArray<string>>;
const packageGraph: PackageGraph = new Map(
  workspacePackages.map((pkg) => [pkg.name, pkg.dependsOn]),
);

// The layer each package sits on, numbered as in monorepo-plan.md's picture (shared 0, log 1,
// env 2, db and linear 3, jobs and observability 4, http and fleet 5, the apps 6). A package's
// dependencies name only packages on a strictly lower layer, so the graph reads one way and a
// loop cannot hide in it. A package joins the list in the phase that creates it; routes holds
// http's slot until it is renamed.
const LAYERS: Readonly<Record<string, number>> = {
  "@oligarchy/shared": 0,
  "@oligarchy/routes": 5,
};

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

// The viz's Solid components are `.tsx`; the same rules bind them, and every workspace package's.
const sources = (): ReadonlyArray<string> =>
  ["src", ...workspacePackages.map((pkg) => `${pkg.dir}/src`)]
    .flatMap(filesUnder)
    .filter((path) => !path.startsWith("src/dashboard/"));

const SHARED_SOURCES = "packages/shared/src/";
const ROUTES_SOURCES = "packages/routes/src/";

const importSpecifiers = (source: string): ReadonlyArray<string> =>
  [...source.matchAll(/^import\s(?:[^;]*?\sfrom\s+)?"([^"]+)";?$/gm)].map((m) => m[1] ?? "");

// A package that is vocabulary or contract alone imports Effect, the packages it is allowed and
// its own modules: nothing of the processes, no platform and no Node.
const confinedImportProblems =
  (dir: string, allowed: RegExp) =>
  (path: string, source: string): ReadonlyArray<string> =>
    importSpecifiers(source).filter((specifier) =>
      specifier.startsWith(".")
        ? !join(dirname(path), specifier).startsWith(dir)
        : !allowed.test(specifier),
    );

// shared is the vocabulary every process speaks, so it knows no other package; and it reads no
// process.*, which the boundary rule below also says of every non-boundary file.
const sharedConfined = confinedImportProblems(SHARED_SOURCES, /^effect(?:\/|$)/);
const sharedImportProblems = (path: string, source: string): ReadonlyArray<string> => [
  ...sharedConfined(path, source),
  ...[...stripStringsAndComments(source).matchAll(/\bprocess\.\w+/g)].map((m) => m[0]),
];

// The routes package is the HTTP contract alone: Effect's schemas, the shared vocabularies its
// bodies carry, and its own modules.
const routesImportProblems = confinedImportProblems(
  ROUTES_SOURCES,
  /^(?:effect(?:\/|$)|@oligarchy\/shared\/)/,
);

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
  "src/qemu/stats.ts",
  "src/qemu/qemu.ts",
  // This process's own cpu and pid, and which host it is on: macOS has no /proc to read them.
  "src/shared/process-usage.ts",
  "src/observability/instrument.ts",
  "src/observability/render.ts",
  "src/db/client.ts",
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
  ["src/db/client.ts", ["runForkWith", "runPromiseExitWith"]],
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
  it("endpoints, groups and the api are declared only in packages/routes/src/api.ts", () => {
    expect(
      violations((path, source) =>
        path === `${ROUTES_SOURCES}api.ts`
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
          'import * as Contract from "@oligarchy/routes/contract";',
          'import * as Log from "../../../src/observability/log.ts";',
          "const home = process.env.HOME;",
          'const tag = "process.env in a string is not a read";',
        ].join("\n"),
      ),
    ).toEqual([
      "node:fs",
      "@effect/platform-node/NodeServices",
      "@oligarchy/routes/contract",
      "../../../src/observability/log.ts",
      "process.env",
    ]);
  });

  it("the routes package imports only effect, shared and its own modules (happy)", () => {
    expect(filesUnder(ROUTES_SOURCES).length).toBeGreaterThan(0);
    expect(violationsIn(filesUnder(ROUTES_SOURCES), routesImportProblems)).toEqual([]);
  });

  it("names a routes import of the main package, a platform, Node or a driver (unhappy)", () => {
    const path = `${ROUTES_SOURCES}contract.ts`;
    expect(
      routesImportProblems(
        path,
        [
          'import { Schema } from "effect";',
          'import * as HttpApi from "effect/unstable/httpapi/HttpApi";',
          'import * as Domain from "@oligarchy/shared/domain";',
          'import * as Errors from "./errors.ts";',
          'import * as Log from "../../../src/observability/log.ts";',
          'import * as NodeServices from "@effect/platform-node/NodeServices";',
          'import { readFileSync } from "node:fs";',
          'import pg from "pg";',
          'import "./side-effect.ts";',
          'import "../test/setup.ts";',
        ].join("\n"),
      ),
    ).toEqual([
      "../../../src/observability/log.ts",
      "@effect/platform-node/NodeServices",
      "node:fs",
      "pg",
      "../test/setup.ts",
    ]);
  });

  it("the main package imports a workspace package as a namespace of an exported module (happy)", () => {
    expect(exportedModules.size).toBeGreaterThan(0);
    expect(
      violationsIn([...filesUnder("src"), ...filesUnder("test")], workspaceImportProblems),
    ).toEqual([]);
  });

  it("every package is in the layer list and depends only on strictly lower layers (happy)", () => {
    expect(packageGraph.size).toBeGreaterThan(0);
    expect(layerProblems(packageGraph, LAYERS)).toEqual([]);
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
          'import * as Api from "@oligarchy/routes/api";',
          'import type * as Contract from "@oligarchy/routes/contract";',
          'import * as Log from "../observability/log.ts";',
          'import * as Errors from "../../packages/routes/src/errors.ts";',
          'import { QemuServerApi } from "@oligarchy/routes/api";',
          'import * as Routes from "@oligarchy/routes";',
          'import * as Source from "@oligarchy/routes/src/api.ts";',
        ].join("\n"),
      ),
    ).toEqual([
      '"../../packages/routes/src/errors.ts" reaches into packages/',
      'import { QemuServerApi } from "@oligarchy/routes/api"',
      '"@oligarchy/routes" is not an exported module',
      '"@oligarchy/routes/src/api.ts" is not an exported module',
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
