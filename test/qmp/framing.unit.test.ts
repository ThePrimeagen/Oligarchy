import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Framing from "../../src/qmp/framing.ts";

const greeting = {
  QMP: {
    version: { qemu: { major: 10, micro: 0, minor: 0 }, package: "v10.0.0" },
    capabilities: ["oob"],
  },
};

const successes = (fed: Framing.Fed): ReadonlyArray<unknown> =>
  fed.frames.map((frame) => {
    expect(Result.isSuccess(frame)).toBe(true);
    return Result.isSuccess(frame) ? frame.success : undefined;
  });

describe("framing happy path", () => {
  it("returns one complete object from a single chunk", () => {
    const fed = Framing.feed("", '{"return":{}}');
    expect(successes(fed)).toEqual([{ return: {} }]);
    expect(fed.rest).toBe("");
  });

  it("keeps a split object incomplete until the closing chunk arrives", () => {
    const first = Framing.feed("", '{"return":');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('{"return":');
    const second = Framing.feed(first.rest, "{}}");
    expect(successes(second)).toEqual([{ return: {} }]);
    expect(second.rest).toBe("");
  });

  it("splits multiple objects from one chunk in FIFO order", () => {
    const fed = Framing.feed(
      "",
      '{"return":{"ok":true},"id":1}{"error":{"class":"GenericError","desc":"nope"},"id":2}',
    );
    expect(successes(fed)).toEqual([
      { return: { ok: true }, id: 1 },
      { error: { class: "GenericError", desc: "nope" }, id: 2 },
    ]);
  });

  it("decodes greeting, success, error and event shapes", () => {
    const text = [
      JSON.stringify(greeting),
      '{"return":{},"id":1}',
      '{"error":{"class":"CommandNotFound","desc":"unknown"},"id":2}',
      '{"event":"STOP","timestamp":{"seconds":1265044230,"microseconds":450486}}',
    ].join("");
    expect(successes(Framing.feed("", text))).toEqual([
      greeting,
      { return: {}, id: 1 },
      { error: { class: "CommandNotFound", desc: "unknown" }, id: 2 },
      { event: "STOP", timestamp: { seconds: 1265044230, microseconds: 450486 } },
    ]);
  });

  it("keeps nested objects and arrays intact", () => {
    expect(successes(Framing.feed("", '{"return":{"a":{"b":[1,{"c":"x"}]}}}'))).toEqual([
      { return: { a: { b: [1, { c: "x" }] } } },
    ]);
  });

  it("skips QEMU-style newlines and whitespace between objects", () => {
    const fed = Framing.feed("", `{"return":{}}\r\n  \n{"event":"RESUME"}\n`);
    expect(successes(fed)).toEqual([{ return: {} }, { event: "RESUME" }]);
    expect(fed.rest).toBe("\n");
  });

  it("emits nothing when there is nothing ready", () => {
    expect(Framing.split("")).toEqual({ frames: [], rest: "" });
    expect(Framing.split("   ")).toEqual({ frames: [], rest: "   " });
  });

  it("leaves a trailing partial object after emitting a complete one", () => {
    const first = Framing.feed("", '{"return":{}}\n{"return":');
    expect(successes(first)).toEqual([{ return: {} }]);
    expect(first.rest).toBe('\n{"return":');
    expect(successes(Framing.feed(first.rest, "{}}"))).toEqual([{ return: {} }]);
  });

  it("frames an object with braces inside a string value", () => {
    const fed = Framing.feed("", '{"error":{"class":"GenericError","desc":"value \'f}\'"},"id":2}');
    expect(successes(fed)).toEqual([
      { error: { class: "GenericError", desc: "value 'f}'" }, id: 2 },
    ]);
    expect(fed.rest).toBe("");
  });

  it("frames a string containing an escaped quote before a brace", () => {
    const { frames, rest } = Framing.split('{"desc":"a \\" b }","id":7}');
    expect(frames).toEqual(['{"desc":"a \\" b }","id":7}']);
    expect(rest).toBe("");
  });
});

describe("framing unhappy path", () => {
  it("does not emit incomplete JSON", () => {
    const fed = Framing.feed("", '{"return": {');
    expect(fed.frames).toEqual([]);
    expect(fed.rest).toBe('{"return": {');
  });

  it("yields a QmpProtocolError for a complete object that is not valid JSON", () => {
    const fed = Framing.feed("", "{nope}");
    expect(fed.frames).toHaveLength(1);
    const failures = fed.frames.filter(Result.isFailure);
    expect(failures.map((frame) => frame.failure._tag)).toEqual(["QmpProtocolError"]);
    expect(failures.map((frame) => frame.failure.message)).toEqual([
      "qemu: invalid QMP frame: {nope}",
    ]);
    expect(fed.rest).toBe("");
  });

  it("yields a QmpProtocolError for JSON that is not a QMP shape", () => {
    const decoded = Framing.decodeFrame('{"foo":1}');
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) {
      expect(decoded.failure._tag).toBe("QmpProtocolError");
      expect(decoded.failure.message).toBe('qemu: invalid QMP frame: {"foo":1}');
    }
  });

  it("emits nothing for input without an object", () => {
    expect(Framing.split("[1,2]")).toEqual({ frames: [], rest: "[1,2]" });
    expect(Framing.split("42")).toEqual({ frames: [], rest: "42" });
  });

  it("keeps an object with an unterminated string incomplete", () => {
    const first = Framing.feed("", '{"desc":"unterminated } ');
    expect(first.frames).toEqual([]);
    const second = Framing.feed(first.rest, 'more"}');
    // A complete frame that is valid JSON but not QMP: the framer saw it whole.
    expect(second.frames.filter(Result.isFailure)).toHaveLength(1);
    expect(second.rest).toBe("");
  });
});
