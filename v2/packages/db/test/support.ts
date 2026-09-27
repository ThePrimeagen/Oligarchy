import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const environment = Env.cli({ name: "db-test", description: "Reads DATABASE_URL" })
  .needs("databaseUrl")
  .done();

// DATABASE_URL as a program receives it: read by Env.create, so a Secret.
export const databaseUrl = async (url: string): Promise<Env.Secret> => {
  const created = await Env.create(
    environment,
    Env.fakeIo({ env: { DATABASE_URL: url }, files: { [Env.CONFIG_PATH]: CONFIG } }),
  );
  if (!created.ok) {
    throw created.error;
  }
  return created.value.vars.databaseUrl;
};

// Every error the pool reported, in order; `next` settles on the next one.
export const poolErrors = () => {
  const seen: Array<Error> = [];
  let waiting: ((error: Error) => void) | undefined;
  return {
    seen,
    onPoolError: (error: Error) => {
      seen.push(error);
      waiting?.(error);
      waiting = undefined;
    },
    next: () =>
      new Promise<Error>((resolve) => {
        waiting = resolve;
      }),
  };
};

// Nothing listens on port 1, so a connection there is refused at once.
export const UNREACHABLE = "127.0.0.1:1";
