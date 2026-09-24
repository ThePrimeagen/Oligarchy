import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Reply from "../../src/driver/reply.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const text = (status: string, did: string, action: string): string =>
  `${status}\n${did}\n${action}`;

describe("reply", () => {
  it("reads continue, what the agent did, and the next action", () => {
    const parsed = Reply.parse(
      text(
        "continue",
        "booted the guest",
        `start --agent-id OLI-1 --server-url http://127.0.0.1:9 --resume`,
      ),
    );
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(parsed.success).toEqual({
      status: "continue",
      did: "booted the guest",
      action: "start --agent-id OLI-1 --server-url http://127.0.0.1:9 --resume",
    });
    const command = Reply.command(parsed.success.action);
    expect(Result.isSuccess(command)).toBe(true);
    if (Result.isFailure(command)) {
      return;
    }
    expect(command.success).toEqual({
      bin: "./client",
      args: ["start", "--agent-id", "OLI-1", "--server-url", "http://127.0.0.1:9", "--resume"],
    });
  });

  it("reads complete as the action taken, and keeps a quoted argument whole", () => {
    const parsed = Reply.parse(
      text("complete", "locked the screen", 'send-keys --keys "hello world"'),
    );
    expect(Result.isSuccess(parsed)).toBe(true);
    if (Result.isFailure(parsed)) {
      return;
    }
    expect(parsed.success.status).toBe("complete");
    expect(parsed.success.did).toBe("locked the screen");
    const command = Reply.command(parsed.success.action);
    expect(Result.isSuccess(command)).toBe(true);
    if (Result.isFailure(command)) {
      return;
    }
    expect(command.success.args).toEqual(["send-keys", "--keys", "hello world"]);
  });

  it("refuses ./ctrl on a drive and allows it on a diagnose", () => {
    const refused = Reply.command(
      "./ctrl diagnose --verdict passed --summary ok --model openrouter/x",
    );
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure.message).toContain("./ctrl");
    }
    const allowed = Reply.command(
      "./ctrl diagnose --verdict passed --summary ok --model openrouter/x",
      true,
    );
    expect(Result.isSuccess(allowed)).toBe(true);
    if (Result.isFailure(allowed)) {
      return;
    }
    expect(allowed.success).toEqual({
      bin: "./ctrl",
      args: ["diagnose", "--verdict", "passed", "--summary", "ok", "--model", "openrouter/x"],
    });
  });

  it("takes ./client-with-image as the bin", () => {
    const command = Reply.command(
      `./client-with-image get-image --agent-id OLI-1 --session-id ${SESSION}`,
    );
    expect(Result.isSuccess(command)).toBe(true);
    if (Result.isFailure(command)) {
      return;
    }
    expect(command.success.bin).toBe("./client-with-image");
    expect(command.success.args[0]).toBe("get-image");
  });

  it("refuses a reply that is not three lines, a bad status, or an empty line", () => {
    expect(Result.isFailure(Reply.parse("continue\nbooted"))).toBe(true);
    expect(Result.isFailure(Reply.parse("continue\nbooted\nstart\nextra"))).toBe(true);
    expect(Result.isFailure(Reply.parse("yes\nbooted\nstart"))).toBe(true);
    expect(Result.isFailure(Reply.parse("continue\n\nstart"))).toBe(true);
    expect(Result.isFailure(Reply.parse("continue\nbooted\n"))).toBe(true);
    const bad = Reply.parse("continue\nbooted");
    if (Result.isSuccess(bad)) {
      expect.fail("a short reply parsed");
    }
    expect(bad.failure.message).toContain("3");
    const status = Reply.parse("yes\nbooted\nstart");
    if (Result.isSuccess(status)) {
      expect.fail("a bad status parsed");
    }
    expect(status.failure.message).toContain("complete");
    expect(status.failure.message).toContain("continue");
  });

  it("refuses an unfinished quote and an intent action", () => {
    const quote = Reply.command('send-keys --keys "hello');
    expect(Result.isFailure(quote)).toBe(true);
    if (Result.isFailure(quote)) {
      expect(quote.failure.message).toContain("quote");
    }
    const intent = Reply.command("intent start --message lock");
    expect(Result.isFailure(intent)).toBe(true);
    if (Result.isFailure(intent)) {
      expect(intent.failure.message).toContain("intent");
    }
  });
});
