// Type checks only: check:types fails when one breaks. Nothing here is sent.
import { describe, expectTypeOf, it } from "vitest";
import type * as Sentry from "../src/main.ts";

declare const sentry: Sentry.Sentry;
declare const span: Sentry.Span;

describe("sentry types", () => {
  it("waits only on the service, and resolves sends and waits to nothing", () => {
    expectTypeOf<ReturnType<Sentry.Sentry["wait"]>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<Sentry.Sentry["sendWait"]>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<ReturnType<Sentry.Span["sendWait"]>>().toEqualTypeOf<Promise<void>>();
    expectTypeOf<Sentry.Span>().not.toHaveProperty("wait");
  });

  it("takes a job only where a trace starts", () => {
    void (() => sentry.trace("drive", { op: "qemu.job", jobId: "job-1" }));
    void (() => sentry.send(new Error("x"), { level: "error", jobId: "job-1" }));
    // @ts-expect-error the root span names its job
    void (() => sentry.trace("drive", { op: "qemu.job" }));
    // @ts-expect-error a span's children are on its trace already
    void (() => span.trace("intent", { op: "agent.intent", jobId: "job-1" }));
    // @ts-expect-error a span's sends are on its trace already
    void (() => span.send(new Error("x"), { level: "error", jobId: "job-1" }));
  });

  it("fails a span only with a failing status", () => {
    void (() => span.fail(new Error("x"), { status: "deadline_exceeded" }));
    // @ts-expect-error ok is not a failure
    void (() => span.fail(new Error("x"), { status: "ok" }));
  });
});
