import * as jarl from "jarl";
import type {
  AnyService,
  ExitReason,
  Io,
  NamesOf,
  NotAService,
  OnExit,
  Provided,
  Provides,
  ServicesOf,
} from "./types.ts";

export class MainCalledTwice extends jarl.error.define("MainCalledTwice") {}

type Main<Environment, Wants extends AnyService> = (
  app: App<Environment, Wants>,
) => Promise<jarl.Result<unknown, unknown>>;

// What an app has done so far. Each registration is its own entry, so a remover takes off only
// its own.
export type State = {
  started: boolean;
  exiting: ExitReason | undefined;
  failed: boolean;
  readonly handlers: Array<{ readonly handler: OnExit }>;
};

const processIo: Io = {
  onSignal: (handler) => {
    const interrupt = () => handler("SIGINT");
    const terminate = () => handler("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    return () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
  },
  exit: (code) => {
    process.exit(code);
  },
};

const call = async (state: State, handler: OnExit, reason: ExitReason): Promise<void> => {
  try {
    await handler(reason);
  } catch (caught) {
    state.failed = true;
    console.error(caught);
  }
};

const exit = async (state: State, reason: ExitReason): Promise<void> => {
  state.exiting = reason;
  for (let entry = state.handlers.pop(); entry !== undefined; entry = state.handlers.pop()) {
    await call(state, entry.handler, reason);
  }
};

const run = async <Environment, S extends Provided | AnyService>(
  app: App<Environment, S>,
  main: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
): Promise<boolean> => {
  try {
    const result = await main(app);
    return result.ok;
  } catch (caught) {
    console.error(caught);
    return false;
  }
};

export class App<const Environment, const S extends Provided | AnyService> {
  readonly environment: Environment;
  readonly services: ServicesOf<S>;
  readonly state: State = { started: false, exiting: undefined, failed: false, handlers: [] };

  // The overloads are the typed face; the bodies below take what they already checked.
  constructor(environment: Environment, services: S & NotAService);
  constructor(environment: Environment, services: ServicesOf<S>) {
    this.environment = environment;
    this.services = services;
  }

  onExit(handler: OnExit): () => void {
    const reason = this.state.exiting;
    if (reason !== undefined) {
      void call(this.state, handler, reason);
      return () => undefined;
    }
    const entry = { handler };
    this.state.handlers.push(entry);
    return () => {
      const at = this.state.handlers.indexOf(entry);
      if (at !== -1) {
        this.state.handlers.splice(at, 1);
      }
    };
  }

  main<Wants extends AnyService = never>(
    main: Main<Environment, Wants> & Provides<Wants, NamesOf<S>>,
    io?: Io,
  ): Promise<jarl.Result<void, MainCalledTwice>>;
  async main(
    main: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
    io: Io = processIo,
  ): Promise<jarl.Result<void, MainCalledTwice>> {
    if (this.state.started) {
      return jarl.err(new MainCalledTwice("main was already called"));
    }
    this.state.started = true;
    let exiting: Promise<void> | undefined;
    const stopListening = io.onSignal((signal) => {
      if (exiting !== undefined) {
        io.exit(1);
        return;
      }
      exiting = exit(this.state, { kind: "signal", signal });
    });
    const ok = await run(this, main);
    exiting ??= exit(this.state, { kind: "returned" });
    await exiting;
    stopListening();
    io.exit(ok && !this.state.failed ? 0 : 1);
    return jarl.ok(undefined);
  }
}
