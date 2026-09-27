import { describe, expect, it } from "vitest";
import { Result } from "effect";
import * as Keys from "../../src/qemu/keys.ts";

const chords = (keys: string, encoding?: string): ReadonlyArray<ReadonlyArray<string>> => {
  const parsed = Keys.parseKeys(keys, encoding);
  expect(Result.isSuccess(parsed)).toBe(true);
  return Result.getOrElse(parsed, () => []);
};

const failure = (keys: string, encoding?: string): string => {
  const parsed = Keys.parseKeys(keys, encoding);
  expect(Result.isFailure(parsed)).toBe(true);
  return Result.match(parsed, {
    onFailure: (error) => {
      expect(error._tag).toBe("KeysError");
      return error.message;
    },
    onSuccess: () => "",
  });
};

describe("parseKeys happy path", () => {
  it("maps lowercase letters and digits to plain chords", () => {
    expect(chords("hi")).toEqual([["h"], ["i"]]);
    expect(chords("42")).toEqual([["4"], ["2"]]);
  });

  it("adds shift for uppercase letters", () => {
    expect(chords("A")).toEqual([["shift", "a"]]);
    expect(chords("Hi")).toEqual([["shift", "h"], ["i"]]);
  });

  it("maps unshifted punctuation and whitespace", () => {
    expect(chords(" ")).toEqual([["spc"]]);
    expect(chords("\n")).toEqual([["ret"]]);
    expect(chords("\t")).toEqual([["tab"]]);
    expect(chords("-")).toEqual([["minus"]]);
    expect(chords(".")).toEqual([["dot"]]);
    expect(chords("/")).toEqual([["slash"]]);
  });

  it("adds shift for shifted punctuation with the unshifted qcode", () => {
    expect(chords("!")).toEqual([["shift", "1"]]);
    expect(chords("?")).toEqual([["shift", "slash"]]);
    expect(chords(":")).toEqual([["shift", "semicolon"]]);
    expect(chords("{")).toEqual([["shift", "bracket_left"]]);
  });

  it("resolves named keys and their aliases, case-insensitively", () => {
    expect(chords("<ENTER>")).toEqual([["ret"]]);
    expect(chords("<enter>")).toEqual([["ret"]]);
    expect(chords("<RETURN>")).toEqual([["ret"]]);
    expect(chords("<esc>")).toEqual([["esc"]]);
    expect(chords("<BS>")).toEqual([["backspace"]]);
    expect(chords("<SPACE>")).toEqual([["spc"]]);
    expect(chords("<PGDN>")).toEqual([["pgdn"]]);
  });

  it("prepends modifiers, short or long names, stacked in order", () => {
    expect(chords("<C-c>")).toEqual([["ctrl", "c"]]);
    expect(chords("<CTRL-c>")).toEqual([["ctrl", "c"]]);
    expect(chords("<A-x>")).toEqual([["alt", "x"]]);
    expect(chords("<M-x>")).toEqual([["meta_l", "x"]]);
    expect(chords("<S-a>")).toEqual([["shift", "a"]]);
    expect(chords("<C-S-c>")).toEqual([["ctrl", "shift", "c"]]);
    expect(chords("<C-ENTER>")).toEqual([["ctrl", "ret"]]);
  });

  it("maps <LT> to less and <GT> to shift+dot", () => {
    expect(chords("<LT>")).toEqual([["less"]]);
    expect(chords("<GT>")).toEqual([["shift", "dot"]]);
  });

  it("takes a trailing - as the minus key, alone or under modifiers", () => {
    expect(chords("<->")).toEqual([["minus"]]);
    expect(chords("<C-->")).toEqual([["ctrl", "minus"]]);
    expect(chords("<A-->")).toEqual([["alt", "minus"]]);
    expect(chords("<C-S-->")).toEqual([["ctrl", "shift", "minus"]]);
    expect(chords("a<C-->b")).toEqual([["a"], ["ctrl", "minus"], ["b"]]);
  });

  it("accepts f-keys and raw qcode tokens", () => {
    expect(chords("<F1>")).toEqual([["f1"]]);
    expect(chords("<F13>")).toEqual([["f13"]]);
    expect(chords("<kp_enter>")).toEqual([["kp_enter"]]);
    expect(chords("<caps_lock>")).toEqual([["caps_lock"]]);
    expect(chords("<unmapped>")).toEqual([["unmapped"]]);
  });

  it("keeps literal and angle chords in input order", () => {
    expect(chords("Hi<ENTER>")).toEqual([["shift", "h"], ["i"], ["ret"]]);
    expect(chords("a<C-c>b")).toEqual([["a"], ["ctrl", "c"], ["b"]]);
  });

  it("returns no chords for an empty string", () => {
    expect(chords("")).toEqual([]);
  });

  it("accepts the oligarchy encoding by default and case-insensitively", () => {
    expect(chords("a")).toEqual([["a"]]);
    expect(chords("a", "")).toEqual([["a"]]);
    expect(chords("a", "oligarchy")).toEqual([["a"]]);
    expect(chords("a", "OLIGARCHY")).toEqual([["a"]]);
  });
});

describe("parseKeys reads the Super key and chords the way driving models write them", () => {
  it("reads a bare Super key by any of its names as meta_l", () => {
    for (const name of ["SUPER", "Super", "super", "WIN", "WINDOWS", "LOGO", "CMD", "META"]) {
      expect(chords(`<${name}>`)).toEqual([["meta_l"]]);
    }
    expect(chords("<super_l>")).toEqual([["meta_l"]]);
    expect(chords("<win_l>")).toEqual([["meta_l"]]);
  });

  it("reads a Super modifier by any of its names as meta_l", () => {
    expect(chords("<SUPER-SPACE>")).toEqual([["meta_l", "spc"]]);
    expect(chords("<super-ENTER>")).toEqual([["meta_l", "ret"]]);
    expect(chords("<Super-S-q>")).toEqual([["meta_l", "shift", "q"]]);
    expect(chords("<WIN-e>")).toEqual([["meta_l", "e"]]);
    expect(chords("<LOGO-e>")).toEqual([["meta_l", "e"]]);
    expect(chords("<CMD-e>")).toEqual([["meta_l", "e"]]);
    expect(chords("<meta_l-RET>")).toEqual([["meta_l", "ret"]]);
  });

  it("reads a key bracketed again inside its chord as that key", () => {
    expect(chords("<M-<SPACE>>")).toEqual([["meta_l", "spc"]]);
    expect(chords("<M-<ENTER>>")).toEqual([["meta_l", "ret"]]);
    expect(chords("<C-S-<TAB>>")).toEqual([["ctrl", "shift", "tab"]]);
    expect(chords("<C-<->>")).toEqual([["ctrl", "minus"]]);
    expect(chords("a<M-<ENTER>>b")).toEqual([["a"], ["meta_l", "ret"], ["b"]]);
  });

  it("reads a chord joined with + as one joined with -", () => {
    expect(chords("<META_L+RET>")).toEqual([["meta_l", "ret"]]);
    expect(chords("<meta_l+ret>")).toEqual([["meta_l", "ret"]]);
    expect(chords("<SUPER+ENTER>")).toEqual([["meta_l", "ret"]]);
    expect(chords("<C+S+t>")).toEqual([["ctrl", "shift", "t"]]);
  });

  it("still reads a lone + and a + under a modifier as the plus key", () => {
    expect(chords("<+>")).toEqual([["shift", "equal"]]);
    expect(chords("<C-+>")).toEqual([["ctrl", "shift", "equal"]]);
  });

  it("reads punctuation written by name", () => {
    expect(chords("<comma>")).toEqual([["comma"]]);
    expect(chords("<COMMA>")).toEqual([["comma"]]);
    expect(chords("<DOLLAR>")).toEqual([["shift", "4"]]);
    expect(chords("<AMPERSAND>")).toEqual([["shift", "7"]]);
    expect(chords("<AMP>")).toEqual([["shift", "7"]]);
  });

  it("still refuses a bracket inside a chord that is not a modified key closed by >> (unhappy)", () => {
    expect(failure("<<SPACE>")).toBe('qemu: unknown key "<SPACE"');
    expect(failure("<M-<SPACE>")).toBe('qemu: unknown key "<SPACE"');
    expect(failure("<M-<BOGUS>>")).toBe('qemu: unknown key "BOGUS"');
    expect(failure("x < /dev/null<ENTER>")).toBe('qemu: unknown key " /dev/null<ENTER"');
  });

  it("still refuses a name it would have to guess at (unhappy)", () => {
    expect(failure("<W-e>")).toBe('qemu: unknown modifier "W"');
    expect(failure("<AND>")).toBe('qemu: unknown key "AND"');
    expect(failure("<SUPER+>")).toBe('qemu: unknown key "SUPER+"');
    expect(failure("<X+c>")).toBe('qemu: unknown modifier "X"');
  });
});

describe("parseKeys unhappy path", () => {
  it("fails on an unknown encoding", () => {
    expect(failure("a", "vim")).toBe('qemu: unknown key encoding "vim"');
  });

  it("fails on an unterminated key sequence", () => {
    expect(failure("<ENTER")).toBe("qemu: unterminated key sequence");
  });

  it("fails on an empty key sequence", () => {
    expect(failure("<>")).toBe("qemu: empty key sequence");
  });

  it("fails on an unknown modifier", () => {
    expect(failure("<X-c>")).toBe('qemu: unknown modifier "X"');
  });

  it("fails on a modifier with no key and on an empty modifier before minus", () => {
    expect(failure("<C->")).toBe('qemu: unknown key ""');
    expect(failure("<-->")).toBe('qemu: unknown modifier ""');
    expect(failure("<C--->")).toBe('qemu: unknown modifier ""');
  });

  it("fails on a raw token carrying non-qcode characters", () => {
    expect(failure("<f}>")).toBe('qemu: unknown key "f}"');
    expect(failure("<f{>")).toBe('qemu: unknown key "f{"');
    expect(failure("<foo bar>")).toBe('qemu: unknown key "foo bar"');
  });

  it("fails on unknown keys and unsupported characters", () => {
    expect(failure("<BOGUS>")).toBe('qemu: unknown key "BOGUS"');
    expect(failure("€")).toBe('qemu: unsupported character "€"');
    expect(failure("😀")).toBe('qemu: unsupported character "😀"');
  });

  it("reports the first bad chord of a longer string", () => {
    expect(failure("ok<BOGUS>ok")).toBe('qemu: unknown key "BOGUS"');
    expect(failure("a€<ENTER")).toBe('qemu: unsupported character "€"');
  });
});
