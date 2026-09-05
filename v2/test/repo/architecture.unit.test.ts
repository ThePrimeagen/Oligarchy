import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../..");

const sources = (): ReadonlyArray<string> =>
  readdirSync(join(root, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith("src/dashboard/"))
    .sort();

const read = (path: string): string => readFileSync(join(root, path), "utf8");

// V2-PLAN §1: the only files allowed to import `node:*`, read `process.*`, or use
// `setTimeout`/`new Promise`/`async`.
const BOUNDARY_FILES = new Set([
  "src/qmp/socket.ts",
  "src/proxy/main.ts",
  "src/session/readline.ts",
  "src/qemu/stats.ts",
  "src/qemu/qemu.ts",
  "src/observability/instrument.ts",
  "src/observability/render.ts",
  "src/db/client.ts",
]);

const isBoundary = (path: string): boolean =>
  BOUNDARY_FILES.has(path) || /^src\/[^/]+\/main\.ts$/.test(path);

// Non-boundary files allowed exactly one node:* import. Effect's Crypto.digest is one-shot, so a
// multi-gigabyte ISO is hashed with node:crypto's streaming createHash; Effect has no inflate, so
// a PNG's deflate stream is opened with node:zlib.
const NODE_IMPORT_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  ["src/qemu/iso.ts", "node:crypto"],
  ["src/session/image.ts", "node:zlib"],
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

const violations = (
  predicate: (path: string, source: string) => ReadonlyArray<string>,
): ReadonlyArray<string> =>
  sources().flatMap((path) => predicate(path, read(path)).map((detail) => `${path}: ${detail}`));

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
  it("endpoints, groups and the api are declared only in src/shared/api.ts", () => {
    expect(
      violations((path, source) =>
        path === "src/shared/api.ts"
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

describe("module conventions", () => {
  it("every relative import is a namespace import with a .ts extension", () => {
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
          if (!specifier.endsWith(".ts")) {
            problems.push(`"${specifier}" lacks .ts`);
          }
          return problems;
        }),
      ),
    ).toEqual([]);
  });

  it("imports Effect core from the barrel and unstable modules by deep path", () => {
    expect(
      violations((_, source) =>
        [...source.matchAll(/from\s+"(effect\/[^"]+)"/g)]
          .map((m) => m[1] ?? "")
          .filter((specifier) => !/^effect\/(unstable\/[a-z]+|testing)$/.test(specifier)),
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
