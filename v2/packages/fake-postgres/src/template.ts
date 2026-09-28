import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const MIGRATIONS = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
const CACHE = fileURLToPath(
  new URL("../../../node_modules/.cache/oligarchy/fake-postgres/", import.meta.url),
);

export type Inputs = {
  readonly pglite: string;
  readonly migrations: ReadonlyArray<{ readonly name: string; readonly text: string }>;
};

// Everything the migrated data directory depends on. JSON keeps each name and text apart.
export const key = (inputs: Inputs): string => {
  const migrations = [...inputs.migrations].sort((a, b) => a.name.localeCompare(b.name));
  return createHash("sha256")
    .update(JSON.stringify({ pglite: inputs.pglite, migrations }))
    .digest("hex");
};

// What drizzle's migrator reads: the journal and the sql it names.
const inputs = async (): Promise<Inputs> => {
  const names = [
    ...(await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")),
    "meta/_journal.json",
  ];
  const pglite: { readonly version: string } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.resolve("@electric-sql/pglite")), "utf8"),
  );
  return {
    pglite: pglite.version,
    migrations: await Promise.all(
      names.map(async (name) => ({ name, text: await readFile(join(MIGRATIONS, name), "utf8") })),
    ),
  };
};

const build = async (): Promise<Blob> => {
  const pg = new PGlite();
  try {
    await migrate(drizzle({ client: pg }), {
      migrationsFolder: MIGRATIONS,
      migrationsTable: "__drizzle_migrations_v2",
    });
    return await pg.dumpDataDir("none");
  } finally {
    await pg.close();
  }
};

const isNotFound = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

// Written aside, then renamed: a process reading the cache never sees half a file. A key the
// migrations moved past is deleted.
const cached = async (): Promise<Blob> => {
  const name = `${key(await inputs())}.tar`;
  const path = join(CACHE, name);
  try {
    return new Blob([await readFile(path)]);
  } catch (thrown) {
    if (!isNotFound(thrown)) {
      throw thrown;
    }
  }
  const dump = await build();
  await mkdir(CACHE, { recursive: true });
  const aside = `${path}.${String(process.pid)}`;
  await writeFile(aside, dump.stream());
  await rename(aside, path);
  const stale = (await readdir(CACHE)).filter((each) => each.endsWith(".tar") && each !== name);
  await Promise.all(stale.map((each) => rm(join(CACHE, each), { force: true })));
  return dump;
};

// A fresh PGlite takes about a second to create its data directory; loading a copy of one takes
// a tenth of that. So the migrated one is built once, kept on disk until the migrations change,
// and read once per process.
let template: Promise<Blob> | undefined;

export const migrated = (): Promise<Blob> => (template ??= cached());
