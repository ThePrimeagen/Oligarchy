import * as jarl from "jarl";

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

// The service was closed. The name says which one, so the caller knows whose
// lifetime ended and can close its own.
export class Closed extends jarl.error.define("Closed") {
  readonly service: string;
  constructor(service: string) {
    super(`${service} is closed`);
    this.service = service;
  }
}

// Close finished the shutdown and at least one cleanup failed. The service is
// still closed: a failed cleanup does not keep it alive.
export class CleanupFailed extends jarl.error.define("CleanupFailed") {
  readonly service: string;
  readonly causes: readonly unknown[];
  constructor(service: string, causes: readonly unknown[]) {
    super(`${service} cleanup failed`);
    this.service = service;
    this.causes = causes;
  }
}

// The deadline passed. The run is still going: nothing is cancelled.
export class TimedOut extends jarl.error.define("TimedOut") {
  readonly service: string;
  readonly after: number;
  constructor(service: string, after: number) {
    super(`${service} timed out after ${after}ms`);
    this.service = service;
    this.after = after;
  }
}

// A throw nobody planned for. It stays a result so a loop can stop on it.
export class Defect extends jarl.error.define("Defect") {
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super(`defect: ${messageOf(cause)}`);
    this.cause = cause;
  }
}

export class AlreadySettled extends jarl.error.define("AlreadySettled") {
  readonly service: string;
  constructor(service: string) {
    super(`${service} latch is already settled`);
    this.service = service;
  }
}
