import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Tools from "../../src/harness/tools.ts";

const SESSION = "6f1c8c2e-1b2a-4d3e-8f4a-9c0b1a2d3e4f";
const MODEL = "openrouter/meta/muse-spark-1.3-contributor";

const ok = (
  name: string,
  body: { readonly args: ReadonlyArray<string>; readonly withImage?: boolean },
): Tools.CommandLine => {
  const result = Tools.commandLine({ name, arguments: JSON.stringify(body) });
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
  it("defines client, ctrl and session, and no command a driver does not run", () => {
    expect(Tools.TOOLS.map((tool) => tool.function.name)).toEqual(["client", "ctrl", "session"]);
    const client = Tools.TOOLS[0];
    expect(client).toBeDefined();
    if (client === undefined) {
      return;
    }
    expect(client.type).toBe("function");
    expect(client.function.parameters).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["args"],
    });
    expect(client.function.parameters.properties.withImage).toMatchObject({ type: "boolean" });
    expect(client.function.description).toContain("./client");
    expect(client.function.description).toContain("send-keys");
    expect(client.function.description).not.toContain("follow");

    const ctrl = Tools.TOOLS[1];
    expect(ctrl).toBeDefined();
    if (ctrl === undefined) {
      return;
    }
    expect(ctrl.function.description).toContain("test-results");
    expect(ctrl.function.description).not.toContain("mint");
    expect(ctrl.function.parameters.properties.withImage).toBeUndefined();

    const session = Tools.TOOLS[2];
    expect(session).toBeDefined();
    if (session === undefined) {
      return;
    }
    expect(session.function.description).toContain("image");
    expect(session.function.description).not.toContain("repl");
  });

  it("turns a client call into ./client, and withImage into ./client-with-image", () => {
    expect(
      ok(
        "client",
        body([
          "send-keys",
          "--agent-id",
          "OLI-1",
          "--session-id",
          SESSION,
          "--keys",
          "hello world",
        ]),
      ),
    ).toEqual({
      bin: "./client",
      args: ["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", "hello world"],
    });

    expect(
      ok(
        "client",
        body(["get-image", "--agent-id", "OLI-1", "--session-id", SESSION, "-o", "shot.png"], {
          withImage: true,
        }),
      ),
    ).toEqual({
      bin: "./client-with-image",
      args: ["get-image", "--agent-id", "OLI-1", "--session-id", SESSION, "-o", "shot.png"],
    });

    expect(ok("client", body(["start", "--agent-id", "OLI-1"], { withImage: false })).bin).toBe(
      "./client",
    );
  });

  it("keeps a quoted key string as one argument and repeats --modifier", () => {
    const keys = ok(
      "client",
      body(["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--keys", 'say "hi"']),
    );
    expect(keys.args[keys.args.length - 1]).toBe('say "hi"');

    expect(
      ok(
        "client",
        body([
          "mouse",
          "click",
          "--agent-id",
          "OLI-1",
          "--session-id",
          SESSION,
          "--x",
          "0",
          "--y",
          "1",
          "--button",
          "right",
          "--modifier",
          "shift",
          "--modifier",
          "super",
        ]),
      ).args,
    ).toEqual([
      "mouse",
      "click",
      "--agent-id",
      "OLI-1",
      "--session-id",
      SESSION,
      "--x",
      "0",
      "--y",
      "1",
      "--button",
      "right",
      "--modifier",
      "shift",
      "--modifier",
      "super",
    ]);
  });

  it("turns ctrl and session calls into those binaries", () => {
    expect(
      ok("ctrl", {
        args: [
          "test-results",
          "--agent-id",
          "OLI-1",
          "--id",
          "result-1",
          "--status",
          "success",
          "--reason",
          "locked",
        ],
      }),
    ).toEqual({
      bin: "./ctrl",
      args: [
        "test-results",
        "--agent-id",
        "OLI-1",
        "--id",
        "result-1",
        "--status",
        "success",
        "--reason",
        "locked",
      ],
    });

    expect(
      ok("ctrl", {
        args: ["session", "--session-id", SESSION, "--all"],
      }).bin,
    ).toBe("./ctrl");

    expect(
      ok("session", {
        args: ["image", "--image-id", SESSION, "-o", "last.png"],
      }),
    ).toEqual({
      bin: "./session",
      args: ["image", "--image-id", SESSION, "-o", "last.png"],
    });
  });

  it("puts a command's stdout on a success and its stderr headline on a failure", () => {
    expect(Tools.toolContent({ exitCode: 0, stdout: `${SESSION}\n`, stderr: "" })).toBe(
      `${SESSION}\n`,
    );
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

  it("a test-results exit of 0 closes the result, and nothing else does", () => {
    const closed = ok("ctrl", {
      args: ["test-results", "--agent-id", "OLI-1", "--id", "result-1", "--status", "failed"],
    });
    expect(Tools.closesResult(closed, 0)).toBe(true);
    expect(Tools.closesResult(closed, 1)).toBe(false);

    const started = ok("ctrl", {
      args: [
        "test",
        "start",
        "--session-id",
        SESSION,
        "--test-result-id",
        "result-1",
        "--model",
        MODEL,
      ],
    });
    expect(Tools.closesResult(started, 0)).toBe(false);

    const diagnosed = ok("ctrl", {
      args: [
        "diagnose",
        "--session-id",
        SESSION,
        "--verdict",
        "passed",
        "--summary",
        "the proof is on screen",
        "--model",
        MODEL,
      ],
    });
    expect(Tools.closesResult(diagnosed, 0)).toBe(false);
  });

  it("refuses a tool that is not client, ctrl or session", () => {
    expect(refused("bash", JSON.stringify({ args: ["ls"] }))).toContain("bash");
    expect(refused("client-with-image", JSON.stringify({ args: ["start"] }))).toContain(
      "client-with-image",
    );
  });

  it("refuses arguments that are not a command object", () => {
    expect(refused("client", "{")).toContain("JSON");
    expect(refused("client", "null")).toContain("object");
    const token = refused(
      "client",
      JSON.stringify({ args: ["start", "--agent-id", "OLI-1"], token: "secret-token" }),
    );
    expect(token).toContain('["token"]');
    expect(token).not.toContain("secret-token");
    expect(
      refused("ctrl", JSON.stringify({ args: ["session", "--all"], withImage: true })),
    ).toContain("withImage");
  });

  it("refuses a command or a flag a driver does not run", () => {
    expect(refused("client", JSON.stringify(body([])))).toContain("command");
    expect(
      refused(
        "client",
        JSON.stringify(body(["follow", "--agent-id", "OLI-1", "--session-id", SESSION])),
      ),
    ).toContain("follow");
    expect(
      refused(
        "ctrl",
        JSON.stringify({
          args: [
            "test",
            "run",
            "--name",
            "lock-screen",
            "--server-url",
            "http://127.0.0.1:1",
            "--iso",
            "https://example.com/x.iso",
            "--version",
            "1",
          ],
        }),
      ),
    ).toContain("test run");
    expect(
      refused(
        "ctrl",
        JSON.stringify({
          args: [
            "mint",
            "--server-url",
            "http://127.0.0.1:1",
            "--iso",
            "https://example.com/x.iso",
          ],
        }),
      ),
    ).toContain("mint");
    expect(refused("session", JSON.stringify({ args: [] }))).toContain("command");
  });

  it("leaves a flag the command itself refuses on the command line", () => {
    expect(
      ok("client", body(["send-keys", "--agent-id", "OLI-1", "--session-id", SESSION, "--rm", "x"]))
        .args,
    ).toContain("--rm");
    expect(
      ok("ctrl", {
        args: [
          "diagnose",
          "--session-id",
          SESSION,
          "--verdict",
          "failed",
          "--summary",
          "hung",
          "--model",
          MODEL,
        ],
      }).bin,
    ).toBe("./ctrl");
    expect(ok("session", { args: ["image", "--image-id", "not-a-uuid"] }).bin).toBe("./session");
  });
});
