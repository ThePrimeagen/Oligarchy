import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSONStreamParser } from "./json-stream.ts";

const greeting = {
  QMP: {
    version: {
      qemu: { major: 10, micro: 0, minor: 0 },
      package: "v10.0.0",
    },
    capabilities: ["oob"],
  },
} satisfies QemuGreetingResponse;

describe("JSONStreamParser happy path", () => {
  it("returns one complete object from a single push", () => {
    const parser = new JSONStreamParser();
    parser.push('{"return":{}}');
    assert.deepEqual(parser.pull(), { return: {} });
  });

  it("keeps a split object incomplete until the closing chunk arrives", () => {
    const parser = new JSONStreamParser();
    parser.push('{"return":');
    assert.equal(parser.pull(), undefined);
    parser.push("{}}");
    assert.deepEqual(parser.pull(), { return: {} });
    assert.equal(parser.pull(), undefined);
  });

  it("pulls multiple objects from one chunk in FIFO order", () => {
    const parser = new JSONStreamParser();
    parser.push('{"return":{"ok":true},"id":1}{"error":{"class":"GenericError","desc":"nope"},"id":2}');
    assert.deepEqual(parser.pull(), { return: { ok: true }, id: 1 });
    assert.deepEqual(parser.pull(), {
      error: { class: "GenericError", desc: "nope" },
      id: 2,
    });
    assert.equal(parser.pull(), undefined);
  });

  it("parses greeting, success, error, and event shapes", () => {
    const parser = new JSONStreamParser();
    parser.push(JSON.stringify(greeting));
    parser.push('{"return":{},"id":1}');
    parser.push('{"error":{"class":"CommandNotFound","desc":"unknown"},"id":2}');
    parser.push(
      '{"event":"STOP","timestamp":{"seconds":1265044230,"microseconds":450486}}',
    );
    assert.deepEqual(parser.pull(), greeting);
    assert.deepEqual(parser.pull(), { return: {}, id: 1 });
    assert.deepEqual(parser.pull(), {
      error: { class: "CommandNotFound", desc: "unknown" },
      id: 2,
    });
    assert.deepEqual(parser.pull(), {
      event: "STOP",
      timestamp: { seconds: 1265044230, microseconds: 450486 },
    });
  });

  it("keeps nested objects and arrays intact", () => {
    const parser = new JSONStreamParser();
    parser.push('{"return":{"a":{"b":[1,{"c":"x"}]}}}');
    assert.deepEqual(parser.pull(), { return: { a: { b: [1, { c: "x" }] } } });
  });

  it("skips QEMU-style newlines and whitespace between objects", () => {
    const parser = new JSONStreamParser();
    parser.push(`{"return":{}}\r\n  \n{"event":"RESUME"}\n`);
    assert.deepEqual(parser.pull(), { return: {} });
    assert.deepEqual(parser.pull(), { event: "RESUME" });
  });

  it("returns undefined when there is nothing ready", () => {
    const parser = new JSONStreamParser();
    assert.equal(parser.pull(), undefined);
    parser.push('{"return":{}}');
    assert.deepEqual(parser.pull(), { return: {} });
    assert.equal(parser.pull(), undefined);
  });

  it("leaves a trailing partial object after pulling a complete one", () => {
    const parser = new JSONStreamParser();
    parser.push('{"return":{}}\n{"return":');
    assert.deepEqual(parser.pull(), { return: {} });
    assert.equal(parser.pull(), undefined);
    parser.push("{}}");
    assert.deepEqual(parser.pull(), { return: {} });
  });

  it("treats any complete object as a response", () => {
    const parser = new JSONStreamParser();
    parser.push('{"foo":1}');
    assert.deepEqual(parser.pull(), { foo: 1 });
  });

  it("frames an object with braces inside a string value", () => {
    const parser = new JSONStreamParser();
    parser.push('{"error":{"class":"GenericError","desc":"value \'f}\'"},"id":2}');
    assert.deepEqual(parser.pull(), {
      error: { class: "GenericError", desc: "value 'f}'" },
      id: 2,
    });
    assert.equal(parser.pull(), undefined);
  });

  it("frames a string containing an escaped quote before a brace", () => {
    const parser = new JSONStreamParser();
    parser.push('{"desc":"a \\" b }","id":7}');
    assert.deepEqual(parser.pull(), { desc: 'a " b }', id: 7 });
  });
});

describe("JSONStreamParser unhappy path", () => {
  it("does not throw on incomplete JSON and returns undefined", () => {
    const parser = new JSONStreamParser();
    assert.doesNotThrow(() => parser.push('{"return": {'));
    assert.equal(parser.pull(), undefined);
  });

  it("throws on pull when a complete object is not valid JSON", () => {
    const parser = new JSONStreamParser();
    parser.push("{nope}");
    assert.throws(() => parser.pull(), SyntaxError);
  });

  it("returns undefined when the buffer has no object", () => {
    const parser = new JSONStreamParser();
    parser.push("[1,2]");
    assert.equal(parser.pull(), undefined);
    const numbers = new JSONStreamParser();
    numbers.push("42");
    assert.equal(numbers.pull(), undefined);
  });

  it("keeps an object with an unterminated string incomplete", () => {
    const parser = new JSONStreamParser();
    parser.push('{"desc":"unterminated } ');
    assert.equal(parser.pull(), undefined);
    parser.push('more"}');
    assert.deepEqual(parser.pull(), { desc: "unterminated } more" });
  });
});
