import type * as App from "@oligarchy/app";
import type * as Http from "@oligarchy/http";
import * as Fake from "@oligarchy/http/testing";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type * as Sentry from "../src/main.ts";
import * as SentryTesting from "../src/testing.ts";
import { errors, held, ingest, JOB_ID, spans, TRACE_ID } from "./support.ts";

const answered = () => Fake.json({ id: "stored" });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the sentry service", () => {
  it("is built by createService over the http it wants, the fake too (happy)", () => {
    expectTypeOf(ingest({ replies: answered() }).sentry).toEqualTypeOf<App.Made<Sentry.Sentry>>();
    expectTypeOf(SentryTesting.sentry().sentry).toEqualTypeOf<App.Made<Sentry.Sentry>>();
    expectTypeOf<Parameters<typeof Sentry.create>[0]>().toEqualTypeOf<{
      readonly http: App.Made<Http.Http>;
    }>();
  });
});

describe("sentry", () => {
  it("puts a job's spans, their children and the errors sent through them on the job's trace, and wait resolves once Sentry has them (happy)", async () => {
    const entered = held<void>();
    const gate = held<void>();
    const { sentry, asked } = ingest({
      replies: async () => {
        entered.release();
        await gate.promise;
        return answered();
      },
    });

    const job = sentry.trace("drive: lock screen", { op: "qemu.job", jobId: JOB_ID });
    const intent = job.trace("open a terminal", { op: "agent.intent" });
    intent.trace("QMP screendump", { op: "qemu.action" }).end("ok");
    intent.send(new Error("the terminal is slow"), { level: "warning" });
    intent.end("ok");
    sentry.send(new Error("the client lost the drive"), { level: "fatal", jobId: JOB_ID });
    job.end("internal_error");

    let settled = false;
    const waited = sentry.wait().then(() => {
      settled = true;
    });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    gate.release();
    await waited;

    const sent = spans(asked);
    const root = sent.find((span) => span.name === "drive: lock screen");
    const opened = sent.find((span) => span.name === "open a terminal");
    const screendump = sent.find((span) => span.name === "QMP screendump");
    expect(root).toMatchObject({ traceId: TRACE_ID, status: "error", message: "internal_error" });
    expect(opened).toMatchObject({ traceId: TRACE_ID, parentId: root?.spanId, status: "ok" });
    expect(screendump).toMatchObject({ parentId: opened?.spanId, status: "ok" });
    expect(errors(asked)).toEqual([
      {
        message: "the terminal is slow",
        level: "warning",
        traceId: TRACE_ID,
        spanId: opened?.spanId,
      },
      {
        message: "the client lost the drive",
        level: "fatal",
        traceId: TRACE_ID,
        spanId: expect.any(String),
      },
    ]);
  });

  it("a send Sentry refuses, cannot reach or never answers still settles, so wait resolves (sad)", async () => {
    const failing: ReadonlyArray<readonly [Fake.Reply, number]> = [
      [Fake.status(500), 10_000],
      ["unreachable", 10_000],
      ["hang", 50],
    ];
    for (const [reply, timeoutMs] of failing) {
      const { sentry, asked } = ingest({ replies: reply, timeoutMs });

      sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID }).fail(new Error("qemu crashed"));

      let settled = false;
      const waited = sentry.wait().then(() => {
        settled = true;
      });
      if (reply === "hang") {
        await vi.advanceTimersByTimeAsync(timeoutMs - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
      } else {
        // The SDK's flush checks for completed event processing after 1 ms.
        await vi.advanceTimersByTimeAsync(1);
      }
      await waited;
      expect(asked.length).toBeGreaterThan(0);
    }
  });
});
