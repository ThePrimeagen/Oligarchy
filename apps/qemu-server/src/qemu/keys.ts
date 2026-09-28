import { Result } from "effect";
import * as Errors from "../errors.ts";

export type Chord = ReadonlyArray<string>;
export type Parsed = Result.Result<ReadonlyArray<Chord>, Errors.KeysError>;

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
  // QEMU names the left Alt, Ctrl and Shift without a suffix; only the right ones carry _r.
  CTRL: "ctrl",
  CTRL_L: "ctrl",
  ALT: "alt",
  ALT_L: "alt",
  SHIFT: "shift",
  SHIFT_L: "shift",
  META_L: "meta_l",
};

// QEMU's QKeyCode enum (qapi/ui.json). QMP refuses any other name, and only after the chords
// before it in the same string were typed, so a name outside it fails here instead.
const QCODES: ReadonlySet<string> = new Set([
  "unmapped",
  "shift",
  "shift_r",
  "alt",
  "alt_r",
  "ctrl",
  "ctrl_r",
  "menu",
  "esc",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "minus",
  "equal",
  "backspace",
  "tab",
  "q",
  "w",
  "e",
  "r",
  "t",
  "y",
  "u",
  "i",
  "o",
  "p",
  "bracket_left",
  "bracket_right",
  "ret",
  "a",
  "s",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "semicolon",
  "apostrophe",
  "grave_accent",
  "backslash",
  "z",
  "x",
  "c",
  "v",
  "b",
  "n",
  "m",
  "comma",
  "dot",
  "slash",
  "asterisk",
  "spc",
  "caps_lock",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "num_lock",
  "scroll_lock",
  "kp_divide",
  "kp_multiply",
  "kp_subtract",
  "kp_add",
  "kp_enter",
  "kp_decimal",
  "sysrq",
  "kp_0",
  "kp_1",
  "kp_2",
  "kp_3",
  "kp_4",
  "kp_5",
  "kp_6",
  "kp_7",
  "kp_8",
  "kp_9",
  "less",
  "f11",
  "f12",
  "print",
  "home",
  "pgup",
  "pgdn",
  "end",
  "left",
  "up",
  "down",
  "right",
  "insert",
  "delete",
  "stop",
  "again",
  "props",
  "undo",
  "front",
  "copy",
  "open",
  "paste",
  "find",
  "cut",
  "lf",
  "help",
  "meta_l",
  "meta_r",
  "compose",
  "pause",
  "ro",
  "hiragana",
  "henkan",
  "yen",
  "muhenkan",
  "katakanahiragana",
  "kp_comma",
  "kp_equals",
  "power",
  "sleep",
  "wake",
  "audionext",
  "audioprev",
  "audiostop",
  "audioplay",
  "audiomute",
  "volumeup",
  "volumedown",
  "mediaselect",
  "mail",
  "calculator",
  "computer",
  "ac_home",
  "ac_back",
  "ac_forward",
  "ac_refresh",
  "ac_bookmarks",
  "lang1",
  "lang2",
  "f13",
  "f14",
  "f15",
  "f16",
  "f17",
  "f18",
  "f19",
  "f20",
  "f21",
  "f22",
  "f23",
  "f24",
]);

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
  CTRL_L: "ctrl",
  CTRL_R: "ctrl_r",
  A: "alt",
  ALT: "alt",
  ALT_L: "alt",
  ALT_R: "alt_r",
  S: "shift",
  SHIFT: "shift",
  SHIFT_L: "shift",
  SHIFT_R: "shift_r",
  M: "meta_l",
  META: "meta_l",
};

const fail = (message: string): Result.Result<never, Errors.KeysError> =>
  Result.fail(Errors.KeysError.make({ message }));

const charChord = (char: string): Result.Result<Chord, Errors.KeysError> => {
  if (char >= "a" && char <= "z") {
    return Result.succeed([char]);
  }
  if (char >= "A" && char <= "Z") {
    return Result.succeed(["shift", char.toLowerCase()]);
  }
  if (char >= "0" && char <= "9") {
    return Result.succeed([char]);
  }
  const plain = UNSHIFTED[char];
  if (plain !== undefined) {
    return Result.succeed([plain]);
  }
  const shifted = SHIFTED[char];
  if (shifted !== undefined) {
    return Result.succeed(["shift", shifted]);
  }
  return fail(`qemu: unsupported character "${char}"`);
};

const keyName = (name: string): Result.Result<Chord, Errors.KeysError> => {
  const named = NAMED[name.toUpperCase()];
  if (named !== undefined) {
    return Result.succeed([named]);
  }
  if (Array.from(name).length === 1) {
    return charChord(name);
  }
  const lower = name.toLowerCase();
  if (QCODES.has(lower)) {
    return Result.succeed([lower]);
  }
  return fail(`qemu: unknown key "${name}"`);
};

const angleChord = (inner: string): Result.Result<Chord, Errors.KeysError> => {
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
  const name = minusKey ? "-" : parts[parts.length - 1];
  // <GT> is shift+dot on a US keyboard.
  if (name.toUpperCase() === "GT") {
    return Result.succeed([...chord, "shift", "dot"]);
  }
  return Result.map(keyName(name), (keys) => [...chord, ...keys]);
};

export const parseKeys = (keys: string, encoding = "oligarchy"): Parsed => {
  if (encoding !== "" && encoding.toLowerCase() !== "oligarchy") {
    return fail(`qemu: unknown key encoding "${encoding}"`);
  }
  const out: Array<Chord> = [];
  const chars = Array.from(keys);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    let chord: Result.Result<Chord, Errors.KeysError>;
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
    if (Result.isFailure(chord)) {
      return Result.fail(chord.failure);
    }
    out.push(chord.success);
  }
  return Result.succeed(out);
};
