import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Reply from "../../src/driver/reply.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";

const line = (body: unknown): string => JSON.stringify(body);

const client = (reason: string, args: ReadonlyArray<string>, withImage?: boolean): string =>
  line({
    name: "client",
    arguments: {
      reason,
      ...(withImage === undefined ? {} : { withImage }),
      args,
    },
  });

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
      client("booted the guest", [
        "start",
        "--agent-id",
        "OLI-1",
        "--server-url",
        "http://127.0.0.1:9",
        "--resume",
      ]),
    );
    expect(parsed).toEqual({
      _tag: "client",
      reason: "booted the guest",
      withImage: false,
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

  it("refuses ./ctrl and ./session: a diagnose is not this loop", () => {
    for (const args of [
      ["./ctrl", "diagnose", "--verdict", "passed", "--summary", "ok", "--model", "openrouter/x"],
      ["./session", "image", "--image-id", "1", "-o", "last.png"],
    ]) {
      const refused = Reply.command(parsedClient(client("bad", args)));
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) {
        expect(refused.failure.message).toContain("./ctrl");
      }
    }
  });

  it("takes withImage, or a leading ./client-with-image, as the bin", () => {
    const image = Reply.command(
      parsedClient(
        client("shot", ["get-image", "--agent-id", "OLI-1", "--session-id", SESSION], true),
      ),
    );
    expect(Result.isSuccess(image)).toBe(true);
    if (Result.isFailure(image)) {
      return;
    }
    expect(image.success.bin).toBe("./client-with-image");
    expect(image.success.args[0]).toBe("get-image");

    const prefixed = Reply.command(
      parsedClient(
        client("shot", [
          "./client-with-image",
          "get-image",
          "--agent-id",
          "OLI-1",
          "--session-id",
          SESSION,
        ]),
      ),
    );
    expect(Result.isSuccess(prefixed)).toBe(true);
    if (Result.isFailure(prefixed)) {
      return;
    }
    expect(prefixed.success.bin).toBe("./client-with-image");
    expect(prefixed.success.args[0]).toBe("get-image");

    const plain = Reply.command(
      parsedClient(client("boot", ["./client", "start", "--agent-id", "OLI-1"], false)),
    );
    expect(Result.isSuccess(plain)).toBe(true);
    if (Result.isFailure(plain)) {
      return;
    }
    expect(plain.success.bin).toBe("./client");
    expect(plain.success.args).toEqual(["start", "--agent-id", "OLI-1"]);
  });

  it("refuses a reply that is not one tool call of the expected shape", () => {
    const cases = [
      "continue\nbooted the guest\nstart",
      `${client("boot", ["start"])}\n${done()}`,
      "hello",
      "",
      line({
        name: "client",
        arguments: { reason: "boot", args: ["start"], token: "secret-token" },
      }),
      line({ name: "bash", arguments: { args: ["ls"] } }),
      line({ name: "client", arguments: { reason: "   ", args: ["start"] } }),
      line({ name: "client", arguments: { reason: "boot", args: [] } }),
      line({ name: "Done", arguments: { reason: "finished" } }),
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
        arguments: { reason: "boot", args: ["start"], token: "secret-token" },
      }),
    );
    if (Result.isSuccess(secret)) {
      expect.fail("an extra field parsed");
    }
    expect(secret.failure.message).toContain("token");
    expect(secret.failure.message).not.toContain("secret-token");
    const unknown = Reply.parse(line({ name: "bash", arguments: {} }));
    if (Result.isSuccess(unknown)) {
      expect.fail("an unknown tool parsed");
    }
    expect(unknown.failure.message).toContain("bash");
    const blank = Reply.parse(
      line({ name: "client", arguments: { reason: "  ", args: ["start"] } }),
    );
    if (Result.isSuccess(blank)) {
      expect.fail("a blank reason parsed");
    }
    expect(blank.failure.message).toContain("reason");
    const empty = Reply.parse(line({ name: "client", arguments: { reason: "boot", args: [] } }));
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
    const onlyBin = Reply.command(parsedClient(client("boot", ["./client"])));
    expect(Result.isFailure(onlyBin)).toBe(true);
    if (Result.isFailure(onlyBin)) {
      expect(onlyBin.failure.message).toContain("action");
    }
  });
});
