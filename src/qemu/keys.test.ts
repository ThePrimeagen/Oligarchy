import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKeys } from "./keys.ts";

describe("parseKeys happy path", () => {
  it("maps lowercase letters and digits to plain chords", () => {
    assert.deepEqual(parseKeys("hi"), [["h"], ["i"]]);
    assert.deepEqual(parseKeys("42"), [["4"], ["2"]]);
  });

  it("adds shift for uppercase letters", () => {
    assert.deepEqual(parseKeys("A"), [["shift", "a"]]);
    assert.deepEqual(parseKeys("Hi"), [["shift", "h"], ["i"]]);
  });

  it("maps unshifted punctuation and whitespace", () => {
    assert.deepEqual(parseKeys(" "), [["spc"]]);
    assert.deepEqual(parseKeys("\n"), [["ret"]]);
    assert.deepEqual(parseKeys("\t"), [["tab"]]);
    assert.deepEqual(parseKeys("-"), [["minus"]]);
    assert.deepEqual(parseKeys("."), [["dot"]]);
    assert.deepEqual(parseKeys("/"), [["slash"]]);
  });

  it("adds shift for shifted punctuation with the unshifted qcode", () => {
    assert.deepEqual(parseKeys("!"), [["shift", "1"]]);
    assert.deepEqual(parseKeys("?"), [["shift", "slash"]]);
    assert.deepEqual(parseKeys(":"), [["shift", "semicolon"]]);
    assert.deepEqual(parseKeys("{"), [["shift", "bracket_left"]]);
  });

  it("resolves named keys and their aliases, case-insensitively", () => {
    assert.deepEqual(parseKeys("<ENTER>"), [["ret"]]);
    assert.deepEqual(parseKeys("<enter>"), [["ret"]]);
    assert.deepEqual(parseKeys("<RETURN>"), [["ret"]]);
    assert.deepEqual(parseKeys("<esc>"), [["esc"]]);
    assert.deepEqual(parseKeys("<BS>"), [["backspace"]]);
    assert.deepEqual(parseKeys("<SPACE>"), [["spc"]]);
    assert.deepEqual(parseKeys("<PGDN>"), [["pgdn"]]);
  });

  it("prepends modifiers, short or long names, stacked in order", () => {
    assert.deepEqual(parseKeys("<C-c>"), [["ctrl", "c"]]);
    assert.deepEqual(parseKeys("<CTRL-c>"), [["ctrl", "c"]]);
    assert.deepEqual(parseKeys("<A-x>"), [["alt", "x"]]);
    assert.deepEqual(parseKeys("<M-x>"), [["meta_l", "x"]]);
    assert.deepEqual(parseKeys("<S-a>"), [["shift", "a"]]);
    assert.deepEqual(parseKeys("<C-S-c>"), [["ctrl", "shift", "c"]]);
    assert.deepEqual(parseKeys("<C-ENTER>"), [["ctrl", "ret"]]);
  });

  it("maps <LT> to less and <GT> to shift+dot", () => {
    assert.deepEqual(parseKeys("<LT>"), [["less"]]);
    assert.deepEqual(parseKeys("<GT>"), [["shift", "dot"]]);
  });

  it("accepts f-keys and raw qcode tokens", () => {
    assert.deepEqual(parseKeys("<F1>"), [["f1"]]);
    assert.deepEqual(parseKeys("<F13>"), [["f13"]]);
    assert.deepEqual(parseKeys("<kp_enter>"), [["kp_enter"]]);
    assert.deepEqual(parseKeys("<caps_lock>"), [["caps_lock"]]);
  });

  it("keeps literal and angle chords in input order", () => {
    assert.deepEqual(parseKeys("Hi<ENTER>"), [["shift", "h"], ["i"], ["ret"]]);
    assert.deepEqual(parseKeys("a<C-c>b"), [["a"], ["ctrl", "c"], ["b"]]);
  });

  it("returns no chords for an empty string", () => {
    assert.deepEqual(parseKeys(""), []);
  });

  it("accepts the oligarchy encoding by default and case-insensitively", () => {
    assert.deepEqual(parseKeys("a"), [["a"]]);
    assert.deepEqual(parseKeys("a", "oligarchy"), [["a"]]);
    assert.deepEqual(parseKeys("a", "OLIGARCHY"), [["a"]]);
  });
});

describe("parseKeys unhappy path", () => {
  it("throws on an unknown encoding", () => {
    assert.throws(() => parseKeys("a", "vim"), {
      message: 'qemu: unknown key encoding "vim"',
    });
  });

  it("throws on an unterminated key sequence", () => {
    assert.throws(() => parseKeys("<ENTER"), {
      message: "qemu: unterminated key sequence",
    });
  });

  it("throws on an empty key sequence", () => {
    assert.throws(() => parseKeys("<>"), {
      message: "qemu: empty key sequence",
    });
  });

  it("throws on an unknown modifier", () => {
    assert.throws(() => parseKeys("<X-c>"), {
      message: 'qemu: unknown modifier "X"',
    });
  });

  it("throws on unknown keys and unsupported characters", () => {
    assert.throws(() => parseKeys("<BOGUS>"), {
      message: 'qemu: unknown key "BOGUS"',
    });
    assert.throws(() => parseKeys("€"), {
      message: 'qemu: unsupported character "€"',
    });
  });
});
