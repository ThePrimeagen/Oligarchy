import { describe, expect, it } from "vitest";
import { Option } from "effect";
import * as Grammar from "../../src/session/grammar.ts";

const SESSION_ID = "6f1c0000-0000-4000-8000-00000000e2a9";

const clientArgs = (line: string): ReadonlyArray<string> => {
  const command = Grammar.parseLine(line);
  switch (command._tag) {
    case "status":
    case "help":
    case "exit":
    case "malformed":
    case "unknown":
      throw new Error(`${line} is not a client command: ${command._tag}`);
    default:
      return Grammar.toClientArgs(command, SESSION_ID);
  }
};

describe("parseLine maps every REPL line to the client's argv", () => {
  it("start with and without iso and disk", () => {
    expect(clientArgs("start")).toEqual(["start"]);
    expect(clientArgs("start https://example.com/omarchy.iso")).toEqual([
      "start",
      "--iso",
      "https://example.com/omarchy.iso",
    ]);
    expect(clientArgs("start omarchy.iso disk.qcow2")).toEqual([
      "start",
      "--iso",
      "omarchy.iso",
      "--disk",
      "disk.qcow2",
    ]);
  });

  it("get-image and get-serial", () => {
    expect(clientArgs("get-image")).toEqual(["get-image", "--session-id", SESSION_ID]);
    expect(clientArgs("get-serial")).toEqual(["get-serial", "--session-id", SESSION_ID]);
  });

  it("send-keys keeps the rest of the line as one keys string", () => {
    expect(clientArgs("send-keys hello world<ENTER>")).toEqual([
      "send-keys",
      "--session-id",
      SESSION_ID,
      "--keys",
      "hello world<ENTER>",
    ]);
  });

  it("mouse verbs take their positional words and hand the client their flags", () => {
    const base = ["mouse", "move", "--session-id", SESSION_ID];
    expect(clientArgs("mouse move 0 1")).toEqual([...base, "--x", "0", "--y", "1"]);
    expect(clientArgs("mouse click 0.5 0.25")).toEqual([
      "mouse",
      "click",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.25",
    ]);
    expect(clientArgs("mouse double-click 0.5 0.25 right")).toEqual([
      "mouse",
      "double-click",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.25",
      "--button",
      "right",
    ]);
    expect(clientArgs("mouse scroll 0.5 0.5 down")).toEqual([
      "mouse",
      "scroll",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--direction",
      "down",
    ]);
    expect(clientArgs("mouse scroll 0.5 0.5 left 3")).toEqual([
      "mouse",
      "scroll",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--direction",
      "left",
      "--ticks",
      "3",
    ]);
    expect(clientArgs("mouse drag 0.1 0.2 0.9 0.2")).toEqual([
      "mouse",
      "drag",
      "--session-id",
      SESSION_ID,
      "--from-x",
      "0.1",
      "--from-y",
      "0.2",
      "--to-x",
      "0.9",
      "--to-y",
      "0.2",
    ]);
    expect(clientArgs("mouse hold 0.5 0.5 middle")).toEqual([
      "mouse",
      "hold",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.5",
      "--button",
      "middle",
    ]);
    expect(clientArgs("mouse release 0.5 0.5")).toEqual([
      "mouse",
      "release",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.5",
    ]);
  });

  it("intent start carries the manual test result id and the rest of the line", () => {
    expect(clientArgs("intent start wait for the boot menu")).toEqual([
      "intent",
      "start",
      "--session-id",
      SESSION_ID,
      "--test-result-id",
      "manual",
      "--message",
      "wait for the boot menu",
    ]);
    expect(Grammar.MANUAL_RESULT_ID).toBe("manual");
  });

  it("intent end", () => {
    expect(clientArgs("intent end")).toEqual(["intent", "end", "--session-id", SESSION_ID]);
  });

  it("stop with an optional status and reason", () => {
    expect(clientArgs("stop")).toEqual(["stop", "--session-id", SESSION_ID]);
    expect(clientArgs("stop failed")).toEqual([
      "stop",
      "--session-id",
      SESSION_ID,
      "--status",
      "failed",
    ]);
    expect(clientArgs("stop succeeded all good")).toEqual([
      "stop",
      "--session-id",
      SESSION_ID,
      "--status",
      "succeeded",
      "--reason",
      "all good",
    ]);
  });

  it("status, help, exit and quit are REPL commands, not client commands", () => {
    expect(Grammar.parseLine("status")).toEqual({ _tag: "status" });
    expect(Grammar.parseLine("help")).toEqual({ _tag: "help" });
    expect(Grammar.parseLine("exit")).toEqual({ _tag: "exit" });
    expect(Grammar.parseLine("quit")).toEqual({ _tag: "exit" });
  });

  it("the parsed start keeps iso and disk as options", () => {
    expect(Grammar.parseLine("start a b")).toEqual({
      _tag: "start",
      iso: Option.some("a"),
      disk: Option.some("b"),
    });
    expect(Grammar.parseLine("start")).toEqual({
      _tag: "start",
      iso: Option.none(),
      disk: Option.none(),
    });
  });

  it("splits on any run of whitespace and ignores surrounding spaces", () => {
    expect(clientArgs("  mouse  click   0.5\t0.25  ")).toEqual([
      "mouse",
      "click",
      "--session-id",
      SESSION_ID,
      "--x",
      "0.5",
      "--y",
      "0.25",
    ]);
  });
});

describe("parseLine refuses malformed lines with the exact usage text", () => {
  it("an unknown command names itself", () => {
    expect(Grammar.parseLine("reboot")).toEqual({ _tag: "unknown", command: "reboot" });
    expect(Grammar.parseLine("follow")).toEqual({ _tag: "unknown", command: "follow" });
    expect(Grammar.parseLine("follow 7a2d0000-0000-4000-8000-00000000f011")).toEqual({
      _tag: "unknown",
      command: "follow",
    });
    expect(Grammar.unknownCommand("reboot")).toBe(
      "unknown command: reboot. tab lists commands; help explains them.",
    );
    expect(Grammar.unknownCommand("follow")).toBe(
      "unknown command: follow. tab lists commands; help explains them.",
    );
  });

  it("start with more than two words", () => {
    expect(Grammar.parseLine("start a b c")).toEqual({
      _tag: "malformed",
      command: "start",
      usage: "usage: start [iso] [disk]",
    });
  });

  it("send-keys without keys", () => {
    expect(Grammar.parseLine("send-keys")).toEqual({
      _tag: "malformed",
      command: "send-keys",
      usage: "usage: send-keys <keys>",
    });
  });

  it("mouse with a missing or unknown verb, or a verb with too few or too many words", () => {
    const verbs = "usage: mouse <move|click|double-click|scroll|drag|hold|release> ...";
    expect(Grammar.parseLine("mouse")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: verbs,
    });
    expect(Grammar.parseLine("mouse wiggle 0 0")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: verbs,
    });
    expect(Grammar.parseLine("mouse move 0.5")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse move <x> <y>",
    });
    expect(Grammar.parseLine("mouse click 0.5")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse click <x> <y> [button]",
    });
    expect(Grammar.parseLine("mouse double-click 0 0 left extra")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse double-click <x> <y> [button]",
    });
    expect(Grammar.parseLine("mouse scroll 0.5 0.5")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse scroll <x> <y> <up|down|left|right> [ticks]",
    });
    expect(Grammar.parseLine("mouse drag 0.1 0.2 0.9")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse drag <x> <y> <to-x> <to-y> [button]",
    });
    expect(Grammar.parseLine("mouse hold")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse hold <x> <y> [button]",
    });
    expect(Grammar.parseLine("mouse release 0 0 left 2")).toEqual({
      _tag: "malformed",
      command: "mouse",
      usage: "usage: mouse release <x> <y> [button]",
    });
  });

  it("intent with a missing or unknown verb, an empty message, or trailing words after end", () => {
    expect(Grammar.parseLine("intent")).toEqual({
      _tag: "malformed",
      command: "intent",
      usage: "usage: intent start <message> | intent end",
    });
    expect(Grammar.parseLine("intent pause")).toEqual({
      _tag: "malformed",
      command: "intent",
      usage: "usage: intent start <message> | intent end",
    });
    expect(Grammar.parseLine("intent start")).toEqual({
      _tag: "malformed",
      command: "intent-start",
      usage: "usage: intent start <message>",
    });
    expect(Grammar.parseLine("intent end now")).toEqual({
      _tag: "malformed",
      command: "intent-end",
      usage: "usage: intent end",
    });
  });

  it("stop with an unknown status", () => {
    expect(Grammar.parseLine("stop done")).toEqual({
      _tag: "malformed",
      command: "stop",
      usage: "usage: stop [succeeded|failed|aborted] [reason]",
    });
    expect(Grammar.STOP_STATUSES).toEqual(["succeeded", "failed", "aborted"]);
  });
});

describe("help and completion", () => {
  it("HELP lists every command on its own line and COMMANDS has each command word", () => {
    expect(Grammar.HELP.split("\n")).toHaveLength(10);
    expect(Grammar.HELP.startsWith("start [iso] [disk]")).toBe(true);
    expect(
      Grammar.HELP.endsWith("exit                                  stop the session and leave"),
    ).toBe(true);
    expect(Grammar.COMMANDS).toEqual([
      "start",
      "get-image",
      "get-serial",
      "send-keys",
      "mouse",
      "intent",
      "stop",
      "status",
      "help",
      "exit",
      "quit",
    ]);
    expect(Grammar.HINT).toBe(
      'tab lists commands; "help" explains them; "exit" stops the session and leaves',
    );
  });

  it("completes command words, intent verbs and stop statuses", () => {
    expect(Grammar.complete("")).toEqual({ _tag: "words", completion: [Grammar.COMMANDS, ""] });
    expect(Grammar.complete("se")).toEqual({
      _tag: "words",
      completion: [["send-keys"], "se"],
    });
    expect(Grammar.complete("mouse d")).toEqual({
      _tag: "words",
      completion: [["double-click", "drag"], "d"],
    });
    expect(Grammar.complete("mouse ")).toEqual({
      _tag: "words",
      completion: [Grammar.MOUSE_VERBS, ""],
    });
    expect(Grammar.complete("intent s")).toEqual({
      _tag: "words",
      completion: [["start"], "s"],
    });
    expect(Grammar.complete("intent ")).toEqual({
      _tag: "words",
      completion: [["start", "end"], ""],
    });
    expect(Grammar.complete("stop f")).toEqual({
      _tag: "words",
      completion: [["failed"], "f"],
    });
  });

  it("completes nothing after other words", () => {
    expect(Grammar.complete("send-keys hel")).toEqual({
      _tag: "words",
      completion: [[], "send-keys hel"],
    });
  });
});
