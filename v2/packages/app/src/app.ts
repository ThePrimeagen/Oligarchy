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

export class App<const Environment, const S extends Provided | AnyService> {
  readonly environment: Environment;
  readonly services: ServicesOf<S>;
  // Each registration is its own entry, so a remover takes off only its own.
  readonly #handlers: Array<{ readonly handler: OnExit }> = [];
  #started = false;
  #exiting: ExitReason | undefined = undefined;
  #failed = false;

  // The overloads are the typed face; the bodies below take what they already checked.
  constructor(environment: Environment, services: S & NotAService);
  constructor(environment: Environment, services: ServicesOf<S>) {
    this.environment = environment;
    this.services = services;
  }

  onExit(handler: OnExit): () => void {
    const reason = this.#exiting;
    if (reason !== undefined) {
      void this.#call(handler, reason);
      return () => undefined;
    }
    const entry = { handler };
    this.#handlers.push(entry);
    return () => {
      const at = this.#handlers.indexOf(entry);
      if (at !== -1) {
        this.#handlers.splice(at, 1);
      }
    };
  }

  main<Wants extends AnyService = never>(
    run: Main<Environment, Wants> & Provides<Wants, NamesOf<S>>,
    io?: Io,
  ): Promise<jarl.Result<void, MainCalledTwice>>;
  async main(
    run: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
    io: Io = processIo,
  ): Promise<jarl.Result<void, MainCalledTwice>> {
    if (this.#started) {
      return jarl.err(new MainCalledTwice("main was already called"));
    }
    this.#started = true;
    let exiting: Promise<void> | undefined;
    const stopListening = io.onSignal((signal) => {
      if (exiting !== undefined) {
        io.exit(1);
        return;
      }
      exiting = this.#exit({ kind: "signal", signal });
    });
    const ok = await this.#run(run);
    exiting ??= this.#exit({ kind: "returned" });
    await exiting;
    stopListening();
    io.exit(ok && !this.#failed ? 0 : 1);
    return jarl.ok(undefined);
  }

  async #run(
    run: (app: App<Environment, S>) => Promise<jarl.Result<unknown, unknown>>,
  ): Promise<boolean> {
    try {
      const result = await run(this);
      return result.ok;
    } catch (caught) {
      console.error(caught);
      return false;
    }
  }

  async #exit(reason: ExitReason): Promise<void> {
    this.#exiting = reason;
    for (let entry = this.#handlers.pop(); entry !== undefined; entry = this.#handlers.pop()) {
      await this.#call(entry.handler, reason);
    }
  }

  async #call(handler: OnExit, reason: ExitReason): Promise<void> {
    try {
      await handler(reason);
    } catch (caught) {
      this.#failed = true;
      console.error(caught);
    }
  }
}
