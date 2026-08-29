// Key-string parsing for the oligarchy encoding: literal characters plus
// angle-bracket names and modifiers, e.g. "Hi<ENTER>" or "<C-S-c>".

const NAMED: Record<string, string> = {
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
  GT: "dot",
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

// Punctuation that needs shift on a US keyboard, mapped to the unshifted qcode.
const SHIFTED: Record<string, string> = {
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

const UNSHIFTED: Record<string, string> = {
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

const MODIFIERS: Record<string, string> = {
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

/** Turns an encoded key string into send-key chords of QEMU qcodes. */
export function parseKeys(s: string, encoding = "oligarchy"): string[][] {
  if (encoding !== "" && encoding.toLowerCase() !== "oligarchy") {
    throw new Error(`qemu: unknown key encoding "${encoding}"`);
  }
  const out: string[][] = [];
  const chars = Array.from(s);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "<") {
      const end = chars.indexOf(">", i + 1);
      if (end < 0) {
        throw new Error("qemu: unterminated key sequence");
      }
      out.push(angleChord(chars.slice(i + 1, end).join("")));
      i = end;
    } else {
      out.push(charChord(chars[i]));
    }
  }
  return out;
}

/** Parses the inside of <...>: optional dash-separated modifiers, then a key. */
function angleChord(inner: string): string[] {
  if (inner === "") {
    throw new Error("qemu: empty key sequence");
  }
  const parts = inner.split("-");
  const chord: string[] = [];
  for (const part of parts.slice(0, -1)) {
    const mod = MODIFIERS[part.toUpperCase()];
    if (mod === undefined) {
      throw new Error(`qemu: unknown modifier "${part}"`);
    }
    chord.push(mod);
  }
  const name = parts[parts.length - 1];
  // <GT> is shift+dot on a US keyboard.
  if (name.toUpperCase() === "GT") {
    return [...chord, "shift", "dot"];
  }
  return [...chord, ...keyName(name)];
}

function keyName(name: string): string[] {
  const named = NAMED[name.toUpperCase()];
  if (named !== undefined) {
    return [named];
  }
  if (Array.from(name).length === 1) {
    return charChord(name);
  }
  // Accept any documented qcode token (f1..f24, kp_*, caps_lock, ...)
  // rather than maintain the full list here.
  const lower = name.toLowerCase();
  if (lower === "unmapped" || lower.includes("_") || lower.startsWith("f")) {
    return [lower];
  }
  throw new Error(`qemu: unknown key "${name}"`);
}

function charChord(char: string): string[] {
  if (char >= "a" && char <= "z") {
    return [char];
  }
  if (char >= "A" && char <= "Z") {
    return ["shift", char.toLowerCase()];
  }
  if (char >= "0" && char <= "9") {
    return [char];
  }
  const plain = UNSHIFTED[char];
  if (plain !== undefined) {
    return [plain];
  }
  const shifted = SHIFTED[char];
  if (shifted !== undefined) {
    return ["shift", shifted];
  }
  throw new Error(`qemu: unsupported character "${char}"`);
}
