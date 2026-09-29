import * as Fake from "@oligarchy/http/testing";
import * as SentryBun from "@sentry/bun";
import { describe, expect, it } from "vitest";
import * as Sentry from "../src/main.ts";
import { errors, held, ingest, JOB_ID, spans, TRACE_ID, within } from "./support.ts";

const answered = () => Fake.json({ id: "stored" });

describe("sending", () => {
  it("puts a job's spans and errors on the job's trace, and wait resolves once every request is answered (happy)", async () => {
    const gate = held<void>();
    const { sentry, asked } = ingest(async () => {
      await gate.promise;
      return answered();
    });

    const job = sentry.trace("drive: lock screen", { op: "qemu.job", jobId: JOB_ID });
    const intent = job.trace("open a terminal", { op: "agent.intent" });
    const action = intent.trace("QMP screendump", {
      op: "qemu.action",
      attributes: { "qemu.command": "screendump" },
    });
    action.end("ok");
    intent.send(new Error("the terminal is slow"), { level: "warning" });
    intent.end("ok");
    sentry.send(new Error("the client lost the drive"), { level: "fatal", jobId: JOB_ID });
    job.end("internal_error");

    const waited = sentry.wait();
    expect(await within(50, waited)).toBe(false);
    gate.release();
    expect(await within(2_000, waited)).toBe(true);

    const sent = spans(asked);
    const root = sent.find((span) => span.name === "drive: lock screen");
    const opened = sent.find((span) => span.name === "open a terminal");
    const screendump = sent.find((span) => span.name === "QMP screendump");
    expect(root).toMatchObject({
      op: "qemu.job",
      traceId: TRACE_ID,
      status: "error",
      message: "internal_error",
    });
    expect(root?.attribute("job_id")).toBe(JOB_ID);
    expect(opened).toMatchObject({
      op: "agent.intent",
      traceId: TRACE_ID,
      parentId: root?.spanId,
      status: "ok",
    });
    expect(screendump).toMatchObject({ op: "qemu.action", parentId: opened?.spanId, status: "ok" });
    expect(screendump?.attribute("qemu.command")).toBe("screendump");
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

  it("wait resolves at once when nothing is open (sad)", async () => {
    const { sentry, asked } = ingest(answered());

    expect(await within(50, sentry.wait())).toBe(true);
    expect(asked).toEqual([]);
  });

  it("a send made while wait is pending keeps every waiter waiting until it settles (sad)", async () => {
    const gates = [held<void>(), held<void>()];
    const waiting = [...gates];
    const { sentry } = ingest(async () => {
      await waiting.shift()?.promise;
      return answered();
    });

    sentry.send(new Error("first"), { level: "error" });
    const first = sentry.wait();
    sentry.send(new Error("second"), { level: "error" });
    const second = sentry.wait();
    gates[0]?.release();
    // Longer than one drain of the SDK and one look at the count: wait goes on until zero.
    expect(await within(1_500, Promise.race([first, second]))).toBe(false);
    gates[1]?.release();
    expect(await within(2_000, Promise.all([first, second]))).toBe(true);
  });

  it("a 500 settles the send (sad)", async () => {
    const { sentry, asked } = ingest(Fake.status(500, "ingest down"));

    sentry.send(new Error("boom"), { level: "error" });

    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("a 429 settles its send, and a send in the backoff after it settles with no request (sad)", async () => {
    const { sentry, asked } = ingest([Fake.status(429), answered()]);

    sentry.send(new Error("limited"), { level: "error" });
    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(await within(50, sentry.sendWait(new Error("backed off"), { level: "error" }))).toBe(
      true,
    );

    expect(await within(50, sentry.wait())).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("an unreachable Sentry settles the send (sad)", async () => {
    const { sentry, asked } = ingest("unreachable");

    sentry.send(new Error("boom"), { level: "error" });

    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("a request Sentry never answers settles at the HTTP timeout, and wait resolves then, not before (sad)", async () => {
    const { sentry } = ingest("hang", { timeoutMs: 200 });

    sentry.send(new Error("into the void"), { level: "error" });
    const waited = sentry.wait();

    expect(await within(100, waited)).toBe(false);
    expect(await within(2_000, waited)).toBe(true);
  });

  it("the same Error sent twice: the SDK drops the second, which settles at once (sad)", async () => {
    const { sentry, asked } = ingest(answered());
    const twice = new Error("twice");

    sentry.send(twice, { level: "error" });
    expect(await within(50, sentry.sendWait(twice, { level: "error" }))).toBe(true);

    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(errors(asked).map((error) => error.message)).toEqual(["twice"]);
  });

  it("with no DSN nothing is sent and every call settles at once (sad)", async () => {
    const fake = Fake.http(answered());
    const sentry = Sentry.create({ dsn: undefined, environment: "test", http: fake.http });

    const job = sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID });
    job.trace("open a terminal", { op: "agent.intent" }).fail(new Error("no terminal"));
    job.end("ok");
    sentry.send(new Error("boom"), { level: "error" });

    expect(await within(50, sentry.sendWait(new Error("boom"), { level: "error" }))).toBe(true);
    expect(await within(50, sentry.wait())).toBe(true);
    expect(fake.asked).toEqual([]);
  });

  it("with a DSN the SDK cannot read nothing is sent and every call settles at once (sad)", async () => {
    const fake = Fake.http(answered());
    const sentry = Sentry.create({ dsn: "not a dsn", environment: "test", http: fake.http });

    sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID }).end("ok");
    sentry.send(new Error("boom"), { level: "error" });

    expect(await within(50, sentry.sendWait(new Error("boom"), { level: "error" }))).toBe(true);
    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(fake.asked).toEqual([]);
  });

  it("an error that throws when the SDK reads it stays inside send, and wait resolves (sad)", async () => {
    const { sentry } = ingest(answered());
    const hostile = new Proxy(new Error("hostile"), {
      get: () => {
        throw new Error("read me and die");
      },
    });

    expect(() => sentry.send(hostile, { level: "error" })).not.toThrow();
    expect(await within(50, sentry.sendWait(hostile, { level: "error" }))).toBe(true);
    expect(await within(2_000, sentry.wait())).toBe(true);
  });

  it("sendWait resolves once its own send settles, while another still waits on Sentry (sad)", async () => {
    const gate = held<void>();
    let made = 0;
    const { sentry } = ingest(async () => {
      if (made++ === 0) {
        await gate.promise;
        return answered();
      }
      return Fake.status(500);
    });

    sentry.send(new Error("held"), { level: "error" });

    expect(await within(2_000, sentry.sendWait(new Error("refused"), { level: "error" }))).toBe(
      true,
    );
    expect(await within(50, sentry.wait())).toBe(false);
    gate.release();
    expect(await within(2_000, sentry.wait())).toBe(true);
  });
});

describe("spans", () => {
  it("a span ended just before wait is sent then, not after the SDK's five-second batch (sad)", async () => {
    const { sentry, asked } = ingest(answered());

    sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID }).end("ok");

    expect(await within(1_000, sentry.wait())).toBe(true);
    expect(spans(asked).map((span) => span.name)).toEqual(["drive"]);
  });

  it("a span the SDK never sends settles once the SDK has nothing left to send (sad)", async () => {
    const { sentry, asked } = ingest(answered());
    const job = sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID });

    await SentryBun.close(100);
    job.end("ok");

    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(spans(asked)).toEqual([]);
  });

  it("a batch of spans Sentry refuses settles every span in it (sad)", async () => {
    const { sentry, asked } = ingest(Fake.status(500));
    const job = sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID });

    job.trace("open a terminal", { op: "agent.intent" }).end("ok");
    job.end("ok");

    expect(await within(2_000, sentry.wait())).toBe(true);
    expect(
      spans(asked)
        .map((span) => span.name)
        .sort(),
    ).toEqual(["drive", "open a terminal"]);
  });

  it("an open span is not counted, so it neither holds wait nor is sent (sad)", async () => {
    const { sentry, asked } = ingest(answered());

    sentry.trace("drive", { op: "qemu.job", jobId: JOB_ID });

    expect(await within(1_000, sentry.wait())).toBe(true);
    expect(spans(asked)).toEqual([]);
  });

  it("a job id that is not a UUID still sends its spans, on a trace of their own (sad)", async () => {
    const { sentry, asked } = ingest(answered());

    sentry.trace("drive", { op: "qemu.job", jobId: "job-7" }).end("ok");

    expect(await within(1_000, sentry.wait())).toBe(true);
    const [root] = spans(asked);
    expect(root?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root?.parentId).toBeUndefined();
    expect(root?.attribute("job_id")).toBe("job-7");
  });
});
