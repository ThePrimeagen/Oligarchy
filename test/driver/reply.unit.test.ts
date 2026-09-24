import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Reply from "../../src/driver/reply.ts";

const line = (body: unknown): string => JSON.stringify(body);

const client = (reason: string, args: ReadonlyArray<string>, step = 1): string =>
  line({ name: "client", arguments: { step, reason, args } });

const done = (): string => line({ name: "Done", arguments: {} });

const parsedClient = (text: string): Extract<Reply.Reply, { readonly _tag: "client" }> => {
  const parsed = Reply.parse(text);
  expect(Result.isSuccess(parsed)).toBe(true);
  if (Result.isFailure(parsed) || parsed.success._tag !== "client") {
    expect.fail("client tool call did not parse");
  }
  return parsed.success;
};

describe("reply", () => {
  it("reads one line: a client tool call, and runs its args", () => {
    const parsed = parsedClient(
      client(
        "booted the guest",
        ["start", "--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9", "--resume"],
        3,
      ),
    );
    expect(parsed).toEqual({
      _tag: "client",
      step: 3,
      reason: "booted the guest",
      args: ["start", "--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9", "--resume"],
    });
    const command = Reply.command(parsed);
    expect(Result.isSuccess(command)).toBe(true);
    if (Result.isFailure(command)) {
      return;
    }
    expect(command.success).toEqual({
      bin: "./client",
      args: ["start", "--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9", "--resume"],
    });
  });

  it("reads Done as leaving the loop, and keeps a quoted argument whole", () => {
    const stopped = Reply.parse(`${done()}\n`);
    expect(Result.isSuccess(stopped)).toBe(true);
    if (Result.isFailure(stopped)) {
      return;
    }
    expect(stopped.success).toEqual({ _tag: "Done" });

    const parsed = parsedClient(
      `  ${client("locked the screen", ["send-keys", "--keys", "hello world"])}  `,
    );
    expect(parsed.reason).toBe("locked the screen");
    const command = Reply.command(parsed);
    expect(Result.isSuccess(command)).toBe(true);
    if (Result.isFailure(command)) {
      return;
    }
    expect(command.success.args).toEqual(["send-keys", "--keys", "hello world"]);
    const quoted = Reply.command(
      parsedClient(client("typed", ["send-keys", "--keys", 'say "hi"'])),
    );
    expect(Result.isSuccess(quoted)).toBe(true);
    if (Result.isFailure(quoted)) {
      return;
    }
    expect(quoted.success.args[quoted.success.args.length - 1]).toBe('say "hi"');
  });

  it("reads the first step as 1, and a client call carries its step and no step-status", () => {
    const parsed = parsedClient(client("open the menu", ["send-keys", "--keys", "a"], 1));
    expect(parsed.step).toBe(1);
    expect(Object.keys(parsed).sort()).toEqual(["_tag", "args", "reason", "step"]);
  });

  it("refuses a client call without a step (unhappy)", () => {
    const parsed = Reply.parse(
      line({ name: "client", arguments: { reason: "boot", args: ["get-image"] } }),
    );
    if (Result.isSuccess(parsed)) {
      expect.fail("a client call without a step parsed");
    }
    expect(parsed.failure.message.startsWith("reply:")).toBe(true);
    expect(parsed.failure.message).toContain("step");
  });

  it("refuses a step that is not a whole number from 1 up (unhappy)", () => {
    for (const step of [0, -1, 1.5, "1", null]) {
      const parsed = Reply.parse(
        line({ name: "client", arguments: { step, reason: "boot", args: ["get-image"] } }),
      );
      if (Result.isSuccess(parsed)) {
        expect.fail(`step ${JSON.stringify(step)} parsed`);
      }
      expect(parsed.failure.message.startsWith("reply:")).toBe(true);
    }
  });

  it("refuses a step-status; there are no steps to complete or continue (unhappy)", () => {
    for (const status of ["completed", "continue"]) {
      const parsed = Reply.parse(
        line({
          name: "client",
          arguments: { step: 1, reason: "boot", "step-status": status, args: ["get-image"] },
        }),
      );
      if (Result.isSuccess(parsed)) {
        expect.fail(`step-status ${status} parsed`);
      }
      expect(parsed.failure.message.startsWith("reply:")).toBe(true);
      expect(parsed.failure.message).toContain("step-status");
    }
  });

  it("refuses a reply that is not one tool call of the expected shape", () => {
    const cases = [
      "continue\nbooted the guest\nstart",
      `${client("boot", ["start"])}\n${done()}`,
      "hello",
      "",
      line({
        name: "client",
        arguments: { step: 1, reason: "boot", args: ["start"], token: "secret-token" },
      }),
      line({
        name: "client",
        arguments: { step: 1, reason: "boot", args: ["start"], withImage: true },
      }),
      line({ name: "bash", arguments: { args: ["ls"] } }),
      line({ name: "client", arguments: { step: 1, reason: "   ", args: ["start"] } }),
      line({ name: "client", arguments: { step: 1, reason: "boot", args: [] } }),
      line({ name: "Done", arguments: { step: 1, reason: "finished" } }),
      line({ name: "Done", arguments: [] }),
      line({ name: "Done", arguments: 1 }),
      line({ name: "done", arguments: {} }),
      line({ reason: "boot", completes: false, action: "start" }),
    ];
    for (const text of cases) {
      const parsed = Reply.parse(text);
      expect(Result.isFailure(parsed)).toBe(true);
      if (Result.isFailure(parsed)) {
        expect(parsed.failure.message.startsWith("reply:")).toBe(true);
      }
    }
    const lines = Reply.parse("continue\nbooted the guest\nstart");
    if (Result.isSuccess(lines)) {
      expect.fail("three lines parsed");
    }
    expect(lines.failure.message).toContain("1 line");
    const secret = Reply.parse(
      line({
        name: "client",
        arguments: { step: 1, reason: "boot", args: ["start"], token: "secret-token" },
      }),
    );
    if (Result.isSuccess(secret)) {
      expect.fail("an extra field parsed");
    }
    expect(secret.failure.message).toContain("token");
    expect(secret.failure.message).not.toContain("secret-token");
    const image = Reply.parse(
      line({
        name: "client",
        arguments: { step: 1, reason: "boot", args: ["start"], withImage: true },
      }),
    );
    if (Result.isSuccess(image)) {
      expect.fail("withImage parsed");
    }
    expect(image.failure.message).toContain("withImage");
    const unknown = Reply.parse(line({ name: "bash", arguments: {} }));
    if (Result.isSuccess(unknown)) {
      expect.fail("an unknown tool parsed");
    }
    expect(unknown.failure.message).toContain("Done");
    expect(unknown.failure.message).toContain("client");
    const blank = Reply.parse(
      line({ name: "client", arguments: { step: 1, reason: "  ", args: ["start"] } }),
    );
    if (Result.isSuccess(blank)) {
      expect.fail("a blank reason parsed");
    }
    expect(blank.failure.message).toContain("reason");
    const empty = Reply.parse(
      line({ name: "client", arguments: { step: 1, reason: "boot", args: [] } }),
    );
    if (Result.isSuccess(empty)) {
      expect.fail("an empty action parsed");
    }
    expect(empty.failure.message).toContain("action");
  });

  it("refuses an intent action", () => {
    const intent = Reply.command(
      parsedClient(client("lock", ["intent", "start", "--message", "lock"])),
    );
    expect(Result.isFailure(intent)).toBe(true);
    if (Result.isFailure(intent)) {
      expect(intent.failure.message).toContain("intent");
    }
  });
});
