import * as jarl from "jarl";
import { QemuFailed } from "./errors.ts";

export type Chord = ReadonlyArray<string>;
export type Parsed = jarl.Result<ReadonlyArray<Chord>, QemuFailed>;

const NAMED: Readonly<Record<string, string>> = {
  ENTER: "ret",
  RETURN: "ret",
  CR: "ret",
  RET: "ret",
  ESC: "esc",
  ESCAPE: "esc",
  TAB: "tab",
  BS: "backspace",
  BACKSPACE: "backspace",
  DEL: "delete",
  DELETE: "delete",
  INS: "insert",
  INSERT: "insert",
  SPACE: "spc",
  SPC: "spc",
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  HOME: "home",
  END: "end",
  PGUP: "pgup",
  PAGEUP: "pgup",
  PGDN: "pgdn",
  PAGEDOWN: "pgdn",
  LT: "less",
  MENU: "menu",
  CAPSLOCK: "caps_lock",
  NUMLOCK: "num_lock",
  SCROLLLOCK: "scroll_lock",
  PRINT: "print",
  PAUSE: "pause",
  SYSREQ: "sysrq",
  CTRL: "ctrl",
  ALT: "alt",
  SHIFT: "shift",
  META_L: "meta_l",
};

const SHIFTED: Readonly<Record<string, string>> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "minus",
  "+": "equal",
  "{": "bracket_left",
  "}": "bracket_right",
  ":": "semicolon",
  '"': "apostrophe",
  "~": "grave_accent",
  "|": "backslash",
  "<": "comma",
  ">": "dot",
  "?": "slash",
};

const UNSHIFTED: Readonly<Record<string, string>> = {
  " ": "spc",
  "\n": "ret",
  "\r": "ret",
  "\t": "tab",
  "-": "minus",
  "=": "equal",
  "[": "bracket_left",
  "]": "bracket_right",
  ";": "semicolon",
  "'": "apostrophe",
  "`": "grave_accent",
  "\\": "backslash",
  ",": "comma",
  ".": "dot",
  "/": "slash",
};

const MODIFIERS: Readonly<Record<string, string>> = {
  C: "ctrl",
  CTRL: "ctrl",
  CONTROL: "ctrl",
  A: "alt",
  ALT: "alt",
  S: "shift",
  SHIFT: "shift",
  M: "meta_l",
  META: "meta_l",
};

const fail = (message: string): jarl.Result<never, QemuFailed> => jarl.err(new QemuFailed(message));

const charChord = (char: string): jarl.Result<Chord, QemuFailed> => {
  if (char >= "a" && char <= "z") {
    return jarl.ok([char]);
  }
  if (char >= "A" && char <= "Z") {
    return jarl.ok(["shift", char.toLowerCase()]);
  }
  if (char >= "0" && char <= "9") {
    return jarl.ok([char]);
  }
  const plain = UNSHIFTED[char];
  if (plain !== undefined) {
    return jarl.ok([plain]);
  }
  const shifted = SHIFTED[char];
  if (shifted !== undefined) {
    return jarl.ok(["shift", shifted]);
  }
  return fail(`qemu: unsupported character "${char}"`);
};

const keyName = (name: string): jarl.Result<Chord, QemuFailed> => {
  const named = NAMED[name.toUpperCase()];
  if (named !== undefined) {
    return jarl.ok([named]);
  }
  if (Array.from(name).length === 1) {
    return charChord(name);
  }
  // Accept any documented qcode token (f1..f24, kp_*, caps_lock, ...) rather than maintain the
  // full list here. Qcodes are lowercase [a-z0-9_]; rejecting anything else keeps a stray "f}"
  // out of the QMP stream.
  const lower = name.toLowerCase();
  if (
    /^[a-z0-9_]+$/.test(lower) &&
    (lower === "unmapped" || lower.includes("_") || lower.startsWith("f"))
  ) {
    return jarl.ok([lower]);
  }
  return fail(`qemu: unknown key "${name}"`);
};

const angleChord = (inner: string): jarl.Result<Chord, QemuFailed> => {
  if (inner === "") {
    return fail("qemu: empty key sequence");
  }
  const parts = inner.split("-");
  // The minus key is itself the separator: "C--" splits to ["C", "", ""], so a trailing pair of
  // empty parts is the "-" key, not an empty modifier and an empty key.
  const minusKey =
    parts.length >= 2 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "";
  const chord: Array<string> = [];
  for (const part of parts.slice(0, minusKey ? -2 : -1)) {
    const modifier = MODIFIERS[part.toUpperCase()];
    if (modifier === undefined) {
      return fail(`qemu: unknown modifier "${part}"`);
    }
    chord.push(modifier);
  }
  const name = minusKey ? "-" : parts[parts.length - 1]!;
  // <GT> is shift+dot on a US keyboard.
  if (name.toUpperCase() === "GT") {
    return jarl.ok([...chord, "shift", "dot"]);
  }
  const keys = keyName(name);
  return jarl.is_err(keys) ? keys : jarl.ok([...chord, ...jarl.value(keys)]);
};

export const parseKeys = (keys: string, encoding = "oligarchy"): Parsed => {
  if (encoding !== "" && encoding.toLowerCase() !== "oligarchy") {
    return fail(`qemu: unknown key encoding "${encoding}"`);
  }
  const out: Array<Chord> = [];
  const chars = Array.from(keys);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    let chord: jarl.Result<Chord, QemuFailed>;
    if (char === "<") {
      const end = chars.indexOf(">", i + 1);
      if (end < 0) {
        return fail("qemu: unterminated key sequence");
      }
      chord = angleChord(chars.slice(i + 1, end).join(""));
      i = end;
    } else {
      chord = charChord(char);
    }
    if (jarl.is_err(chord)) {
      return jarl.err(chord.error);
    }
    out.push(jarl.value(chord));
  }
  return jarl.ok(out);
};
