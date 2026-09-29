import { describe, expect, it } from "vitest";
import * as Fake from "../src/testing.ts";

const names = (spans: ReadonlyArray<Fake.Recorded>) => spans.map((span) => span.name);

describe("spans", () => {
  it("nests spans, sends each error through the span it was sent on, and ends children before parents (happy)", () => {
    const fake = Fake.sentry();
    const slow = new Error("the terminal is slow");
    const missing = new Error("no icon");
    const lost = new Error("the client lost the drive");

    const job = fake.sentry.trace("drive", {
      op: "qemu.job",
      jobId: "job-1",
      attributes: { model: "m" },
    });
    const intent = job.trace("open a terminal", { op: "agent.intent" });
    const nested = intent.trace("find the icon", { op: "agent.intent" });
    nested.fail(missing);
    intent.send(slow, { level: "warning" });
    intent.end("ok");
    job.end("ok");
    fake.sentry.send(lost, { level: "fatal", jobId: "job-1" });

    expect(fake.roots).toEqual([
      {
        name: "drive",
        op: "qemu.job",
        jobId: "job-1",
        attributes: { model: "m" },
        status: "ok",
        sent: [],
        children: [
          {
            name: "open a terminal",
            op: "agent.intent",
            jobId: "job-1",
            attributes: {},
            status: "ok",
            sent: [{ error: slow, report: { level: "warning" }, jobId: "job-1" }],
            children: [
              {
                name: "find the icon",
                op: "agent.intent",
                jobId: "job-1",
                attributes: {},
                status: "internal_error",
                sent: [{ error: missing, report: { level: "error" }, jobId: "job-1" }],
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    expect(names(fake.ended)).toEqual(["find the icon", "open a terminal", "drive"]);
    expect(fake.sent).toEqual([
      { error: missing, report: { level: "error" }, jobId: "job-1" },
      { error: slow, report: { level: "warning" }, jobId: "job-1" },
      { error: lost, report: { level: "fatal" }, jobId: "job-1" },
    ]);
  });

  it("ending a parent ends what is still open under it first, newest first, as aborted (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });
    const intent = job.trace("open a terminal", { op: "agent.intent" });
    intent.trace("QMP send-key", { op: "qemu.action" });
    const screendump = intent.trace("QMP screendump", { op: "qemu.action" });
    screendump.trace("decode", { op: "png" });

    job.end("deadline_exceeded");

    expect(names(fake.ended)).toEqual([
      "decode",
      "QMP screendump",
      "QMP send-key",
      "open a terminal",
      "drive",
    ]);
    const [root] = fake.roots;
    expect(root?.status).toBe("deadline_exceeded");
    expect(root?.attributes).toEqual({});
    for (const span of fake.ended.slice(0, -1)) {
      expect(span.status).toBe("aborted");
      expect(span.attributes).toEqual({ ended_by_parent: true });
    }
  });

  it("a second end does nothing (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });

    job.end("ok");
    job.end("internal_error");

    expect(names(fake.ended)).toEqual(["drive"]);
    expect(fake.roots[0]?.status).toBe("ok");
  });

  it("a span opened under an ended span is never recorded, but an error sent through it lands on the ended span (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });
    const late = new Error("late");

    job.end("ok");
    const after = job.trace("after the end", { op: "agent.intent" });
    after.trace("deeper", { op: "qemu.action" }).end("ok");
    after.set({ ignored: true });
    after.end("ok");
    after.send(late, { level: "error" });

    expect(fake.roots[0]?.children).toEqual([]);
    expect(fake.roots[0]?.sent).toEqual([
      { error: late, report: { level: "error" }, jobId: "job-1" },
    ]);
    expect(names(fake.ended)).toEqual(["drive"]);
  });

  it("set after end is ignored (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });

    job.set({ model: "m" });
    job.end("ok");
    job.set({ model: "other", late: true });

    expect(fake.roots[0]?.attributes).toEqual({ model: "m" });
  });

  it("fail on an ended span still sends the error, and does not end it again (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });
    const crashed = new Error("qemu crashed");

    job.end("ok");
    job.fail(crashed, { status: "deadline_exceeded" });

    expect(fake.roots[0]?.status).toBe("ok");
    expect(fake.roots[0]?.sent).toEqual([
      { error: crashed, report: { level: "error" }, jobId: "job-1" },
    ]);
    expect(names(fake.ended)).toEqual(["drive"]);
  });

  it("a child that fails leaves its parent the status the caller gives it (sad)", () => {
    const fake = Fake.sentry();
    const job = fake.sentry.trace("drive", { op: "qemu.job", jobId: "job-1" });
    const action = job.trace("QMP screendump", { op: "qemu.action" });
    const slow = new Error("no answer");

    action.fail(slow, { level: "fatal", status: "deadline_exceeded" });
    job.end("ok");

    expect(fake.roots[0]?.status).toBe("ok");
    expect(fake.roots[0]?.children[0]).toMatchObject({
      status: "deadline_exceeded",
      sent: [{ error: slow, report: { level: "fatal" }, jobId: "job-1" }],
    });
  });
});
