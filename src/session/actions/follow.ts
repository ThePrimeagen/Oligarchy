import { createInterface, type CompleterResult, type Key } from "node:readline";
import { canPlaceImages, clearImages, placeImage } from "../../terminal/image.ts";
import { type Session, runCtrl, spawnClient } from "../client.ts";

export type SessionListItem = {
  id: string;
  status: "downloading" | "running" | "succeeded" | "failed" | "aborted" | "timed_out";
  startedAt: string;
};

// The action column; the image takes every column to its right.
const LEFT_COLS = 40;
// More rows than any terminal shows: lines that scroll off the top are gone for good.
const MAX_ENTRIES = 200;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_MS = 80;
const GRAY = "\x1b[90m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const CRLF_DELAY_MS = 100;
const STATUS_COLOR: Record<Extract<FollowEvent, { type: "session" }>["status"], string> = {
  pending: GRAY,
  running: "\x1b[33m",
  succeeded: GREEN,
  failed: RED,
  aborted: "\x1b[91m",
  timed_out: "\x1b[35m",
};

let closePicker: (() => void) | undefined;
let cancelSessionList: (() => void) | undefined;

export function enableFollowPickerCompletion(readline: { line: string }): void {
  const interfaceState = readline as { line: string; isCompletionEnabled: boolean };
  let isCompletionEnabled = interfaceState.isCompletionEnabled;
  // Node disables completion before the final character of an input chunk. Keep it
  // enabled for follow so a Tab and Enter received together still enter the picker.
  Object.defineProperty(interfaceState, "isCompletionEnabled", {
    get: () => isCompletionEnabled || /^\s*follow\s+/.test(interfaceState.line),
    set: (enabled: boolean) => {
      isCompletionEnabled = enabled;
    },
  });
}

export function closeFollowPicker(): void {
  cancelSessionList?.();
  closePicker?.();
}

export async function completeFollow(
  session: Session,
  readline: { getCursorPos(): { cols: number }; prompt(preserveCursor?: boolean): void },
  prefix: string,
): Promise<CompleterResult> {
  const controller = new AbortController();
  cancelSessionList = () => controller.abort();
  const rows = runCtrl(session, ["session", "list", "--count", "10", "--json"], controller.signal).then((result) => {
    if (result.code !== 0) {
      throw new Error(result.stderr);
    }
    const matching = (JSON.parse(result.stdout.toString("utf8")) as SessionListItem[]).filter((row) => row.id.startsWith(prefix));
    if (prefix !== "" && matching.length === 0) {
      throw new Error("no matching running or pending sessions");
    }
    return matching;
  });
  try {
    const sessionId = await pickFollowSession(rows, process.stdin, process.stdout, readline.getCursorPos().cols);
    if (sessionId === undefined) {
      controller.abort();
    }
    return [sessionId === undefined ? [] : [sessionId], prefix];
  } catch (err) {
    process.stdout.write(`\r\n${(err as Error).message}\r\n`);
    readline.prompt(true);
    return [[], prefix];
  } finally {
    cancelSessionList = undefined;
  }
}

export function pickFollowSession(
  rows: Promise<SessionListItem[]>,
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  cursorColumn: number,
): Promise<string | undefined> {
  let sessions: SessionListItem[] | undefined;
  let selected = 0;
  let lineCount = 1;
  let visibleCount = 1;
  let closed = false;
  const previousKeypressListeners = input.listeners("keypress");
  for (const listener of previousKeypressListeners) {
    input.removeListener("keypress", listener);
  }

  const drawPicker = (listed: SessionListItem[], redraw: boolean): void => {
    if (redraw) {
      output.write(`\x1b[${lineCount - 1}A\r`);
    } else {
      output.write("\r");
    }
    const columns = output.columns ?? 80;
    const first = Math.min(selected, listed.length - visibleCount);
    output.write(`\x1b[2K${"  active sessions".slice(0, columns)}\r\n`);
    for (const [offset, session] of listed.slice(first, first + visibleCount).entries()) {
      const index = first + offset;
      const marker = index === selected ? "\x1b[36m›\x1b[0m" : " ";
      const label = session.status === "running" ? "running" : "pending";
      const id = session.id.slice(0, Math.max(0, columns - 11));
      output.write(`\x1b[2K${marker} ${STATUS_COLOR[label]}${label}${RESET}  ${id}\r\n`);
    }
    output.write(`\x1b[2K${"  ↑/↓ or tab navigate • enter select • esc/ctrl-c cancel".slice(0, columns)}`);
  };

  return new Promise((resolve, reject) => {
    const leave = (done: () => void, swallowLineFeed = false): void => {
      if (closed) {
        return;
      }
      closed = true;
      closePicker = undefined;
      input.pause();
      input.removeListener("keypress", onKeypress);
      output.write("\r");
      for (let line = 0; line < lineCount; line++) {
        output.write("\x1b[2K");
        if (line < lineCount - 1) {
          output.write("\x1b[1A");
        }
      }
      output.write(`\x1b[1A\x1b[${cursorColumn + 1}G\x1b[?25h`);
      // One terminal Enter can parse as CR and LF keypresses. Restore readline
      // after that pair so the LF cannot submit the completed command.
      queueMicrotask(() => {
        const restoreReadline = () => {
          for (const listener of previousKeypressListeners) {
            input.on("keypress", listener);
          }
        };
        if (!swallowLineFeed) {
          restoreReadline();
          done();
          return;
        }
        const timer = setTimeout(() => {
          input.removeListener("keypress", afterEnter);
          restoreReadline();
        }, CRLF_DELAY_MS);
        timer.unref();
        const afterEnter = (text: string | undefined, key: Key): void => {
          clearTimeout(timer);
          input.removeListener("keypress", afterEnter);
          restoreReadline();
          if (!(text === "\n" && key.name === "enter")) {
            input.emit("keypress", text, key);
          }
        };
        input.on("keypress", afterEnter);
        done();
      });
    };

    const onKeypress = (_text: string | undefined, key: Key): void => {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cancelSessionList?.();
        leave(() => resolve(undefined));
      } else if (sessions === undefined) {
        return;
      } else if (key.name === "up" || (key.name === "tab" && key.shift)) {
        selected = (selected - 1 + sessions.length) % sessions.length;
        drawPicker(sessions, true);
      } else if (key.name === "down" || key.name === "tab") {
        selected = (selected + 1) % sessions.length;
        drawPicker(sessions, true);
      } else if (key.name === "return" || key.name === "enter") {
        leave(() => resolve(sessions![selected].id), true);
      }
    };

    closePicker = () => leave(() => resolve(undefined));
    input.on("keypress", onKeypress);
    output.write("\x1b[?25l\r\n\x1b[2K  loading sessions...");
    input.resume();
    void rows.then(
      (listed) => {
        if (closed) {
          return;
        }
        sessions = listed
          .filter((row) => row.status === "running" || row.status === "downloading")
          .sort((a, b) => Number(a.status === "downloading") - Number(b.status === "downloading"));
        if (sessions.length === 0) {
          leave(() => reject(new Error("no running or pending sessions")));
          return;
        }
        visibleCount = Math.max(1, Math.min(sessions.length, (output.rows ?? 24) - 3));
        lineCount = visibleCount + 2;
        drawPicker(sessions, false);
      },
      (err) => {
        if (!closed) {
          leave(() => reject(err));
        }
      },
    );
  });
}

type Entry = {
  id: number | "intent";
  indent: 0 | 2;
  name: string;
  state: "running" | "completed" | "failed";
};

type View = {
  id: string;
  status: Extract<FollowEvent, { type: "session" }>["status"];
  entries: Entry[];
  png: Buffer | undefined;
  frame: number;
};

function apply(view: View, event: FollowEvent): void {
  switch (event.type) {
    case "session":
      view.status = event.status;
      break;
    case "intent":
      if (event.state === "started") {
        view.entries.push({ id: "intent", indent: 0, name: event.message, state: "running" });
      } else {
        const open = view.entries.findLast((entry) => entry.id === "intent" && entry.state === "running");
        if (open !== undefined) {
          open.state = event.state === "completed" ? "completed" : "failed";
        }
      }
      break;
    case "action":
      if (event.state === "running") {
        const intent = view.entries.findLast((entry) => entry.id === "intent");
        view.entries.push({ id: event.id, indent: intent?.state === "running" ? 2 : 0, name: event.name, state: "running" });
      } else {
        const entry = view.entries.find((candidate) => candidate.id === event.id);
        if (entry !== undefined) {
          entry.state = event.state;
        }
      }
      break;
    case "image":
      view.png = Buffer.from(event.png, "base64");
      break;
  }
  if (view.entries.length > MAX_ENTRIES) {
    view.entries.splice(0, view.entries.length - MAX_ENTRIES);
  }
}

// Every line is written over in full at a fixed width and nothing ever wraps or writes a
// newline, so the screen never scrolls and the image placement to the right stays put.
function draw(view: View): void {
  const rows = process.stdout.rows ?? 24;
  const glyph = SPINNER[view.frame % SPINNER.length];
  const header = `following ${view.id.slice(0, 8)} `;
  let out = `\x1b[1;2H${header}${STATUS_COLOR[view.status]}${view.status}${RESET}${" ".repeat(LEFT_COLS - 1 - header.length - view.status.length)}`;
  const visible = view.entries.slice(-(rows - 2));
  for (let row = 2; row < rows; row++) {
    const entry = visible[row - 2];
    out += `\x1b[${row};2H`;
    if (entry === undefined) {
      out += " ".repeat(LEFT_COLS - 1);
      continue;
    }
    const width = LEFT_COLS - 3 - entry.indent;
    const label = entry.name.length > width ? `${entry.name.slice(0, width - 1)}…` : entry.name;
    const mark = entry.state === "running" ? `${GRAY}${glyph}` : entry.state === "completed" ? `${GREEN}✓` : `${RED}✗`;
    out += `${" ".repeat(entry.indent)}${mark} ${label}${RESET}${" ".repeat(width - label.length)}`;
  }
  out += `\x1b[${rows};2H${GRAY}ctrl-c detaches${RESET}`;
  process.stdout.write(out);
}

function drawImage(view: View): void {
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;
  if (view.png === undefined || cols - LEFT_COLS - 1 < 1) {
    return;
  }
  placeImage(view.png, { col: LEFT_COLS + 2, row: 2, cols: cols - LEFT_COLS - 1, rows: rows - 1 });
}

export async function followRun(session: Session, rest: string): Promise<void> {
  const words = rest === "" ? [] : rest.split(/\s+/);
  if (words.length !== 1) {
    console.log("usage: follow <session-id>");
    return;
  }
  if (!canPlaceImages) {
    console.log("follow needs the kitty graphics protocol (ghostty or kitty)");
    return;
  }
  const id = words[0];
  const view: View = { id, status: "pending", entries: [], png: undefined, frame: 0 };
  const child = spawnClient(session, ["follow", "--session-id", id]);
  session.following = child;
  const err: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));

  let onScreen = false;
  let spinner: NodeJS.Timeout | undefined;
  const redraw = () => {
    process.stdout.write("\x1b[2J");
    clearImages();
    draw(view);
    drawImage(view);
  };
  // The screen is taken on the first event, not before: a refused follow never flashes it.
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!onScreen) {
      onScreen = true;
      process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
      process.stdout.on("resize", redraw);
      spinner = setInterval(() => {
        view.frame++;
        draw(view);
      }, SPINNER_MS);
    }
    const event = JSON.parse(line) as FollowEvent;
    apply(view, event);
    draw(view);
    if (event.type === "image") {
      drawImage(view);
    }
  });

  // The screen is handed back inside the close listener itself, so anyone else awaiting
  // this child's close (shutdown, on a signal) finds the terminal already restored.
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (onScreen) {
        clearInterval(spinner);
        process.stdout.off("resize", redraw);
        clearImages();
        process.stdout.write("\x1b[?25h\x1b[?1049l");
      }
      resolve(code);
    });
  });
  session.following = undefined;
  if (child.killed) {
    console.log(`detached from ${id}`);
  } else if (code !== 0) {
    console.log(Buffer.concat(err).toString("utf8").trim());
  } else if (view.status === "pending" || view.status === "running") {
    // The proxy only ends a stream early when the follower stopped reading it.
    console.log(`dropped from ${id}: this follower fell behind`);
  } else {
    console.log(`session ${id} ${view.status}`);
  }
}
