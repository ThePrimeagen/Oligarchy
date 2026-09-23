import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Tools from "../../src/harness/tools.ts";

const ok = (body: {
  readonly args: ReadonlyArray<string>;
  readonly withImage?: boolean;
}): Tools.CommandLine => {
  const result = Tools.commandLine({ name: "client", arguments: JSON.stringify(body) });
  if (Result.isFailure(result)) {
    expect.fail(result.failure.message);
  }
  return result.success;
};

const refused = (name: string, argumentsText: string): string => {
  const result = Tools.commandLine({ name, arguments: argumentsText });
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) {
    expect(result.failure._tag).toBe("ToolError");
    return result.failure.message;
  }
  return "";
};

const body = (args: ReadonlyArray<string>, extra?: { readonly withImage: boolean }) =>
  extra === undefined ? { args } : { withImage: extra.withImage, args };

describe("driver tools", () => {
  it("gives the model client.md and no ctrl tool", () => {
    expect(Tools.TOOLS.map((tool) => tool.function.name)).toEqual(["client"]);
    const client = Tools.TOOLS[0];
    expect(client).toBeDefined();
    if (client === undefined) {
      return;
    }
    const guide = readFileSync(new URL("../../client.md", import.meta.url), "utf8");
    expect(client.type).toBe("function");
    expect(client.function.description).toBe(guide);
    expect(client.function.description).toContain("## Synopsis");
    expect(client.function.description).toContain("## The loop");
    expect(client.function.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["args"],
    });
    expect(client.function.parameters.properties.withImage).toMatchObject({ type: "boolean" });
  });

  it("runs the args the model sends, as ./client or ./client-with-image", () => {
    expect(ok(body(["send-keys", "--agent-id", "OLI-1", "--keys", "hello world"]))).toEqual({
      bin: "./client",
      args: ["send-keys", "--agent-id", "OLI-1", "--keys", "hello world"],
    });
    expect(
      ok(body(["get-image", "--agent-id", "OLI-1", "-o", "shot.png"], { withImage: true })),
    ).toEqual({
      bin: "./client-with-image",
      args: ["get-image", "--agent-id", "OLI-1", "-o", "shot.png"],
    });
    expect(ok(body(["start", "--agent-id", "OLI-1"], { withImage: false })).bin).toBe("./client");
    expect(ok(body([])).args).toEqual([]);
    const quoted = ok(body(["send-keys", "--agent-id", "OLI-1", "--keys", 'say "hi"']));
    expect(quoted.args[quoted.args.length - 1]).toBe('say "hi"');
  });

  it("puts a command's stdout on a success and its stderr headline on a failure", () => {
    expect(Tools.toolContent({ exitCode: 0, stdout: "saved\n", stderr: "" })).toBe("saved\n");
    expect(Tools.toolContent({ exitCode: 0, stdout: "saved\n", stderr: "note\n" })).toBe(
      "saved\nnote\n",
    );
    expect(
      Tools.toolContent({ exitCode: 1, stdout: "", stderr: "OLIGARCHY_TOKEN is not set\n" }),
    ).toBe("OLIGARCHY_TOKEN is not set\n");
    expect(Tools.toolContent({ exitCode: 1, stdout: "partial", stderr: "start: refused\n" })).toBe(
      "start: refused\npartial",
    );
  });

  it("refuses ctrl, session, and a payload that is not the client's arguments", () => {
    expect(
      refused("ctrl", JSON.stringify({ args: ["test-results", "--status", "success"] })),
    ).toContain("ctrl");
    expect(refused("session", JSON.stringify({ args: ["image", "--image-id", "x"] }))).toContain(
      "session",
    );
    expect(refused("bash", JSON.stringify({ args: ["ls"] }))).toContain("bash");
    expect(
      refused("client", JSON.stringify({ args: ["intent", "start", "--message", "lock"] })),
    ).toContain("intent");
    expect(refused("client", JSON.stringify({ args: ["intent", "end"] }))).toContain("intent");
    expect(refused("client", "{")).toContain("JSON");
    expect(refused("client", "null")).toContain("object");
    const token = refused("client", JSON.stringify({ args: ["start"], token: "secret-token" }));
    expect(token).toContain('["token"]');
    expect(token).not.toContain("secret-token");
  });
});
