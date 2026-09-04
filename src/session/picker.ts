import type { Key } from "node:readline";

export type SessionListItem = {
  id: string;
  status: "downloading" | "running" | "succeeded" | "failed" | "aborted" | "timed_out";
  startedAt: string;
};

const STATUS_WIDTH = "running".length;
const RESET = "\x1b[0m";
const STATUS_COLOR = {
  downloading: "\x1b[90m",
  running: "\x1b[33m",
} as const;
const STATUS_LABEL = {
  downloading: "pending",
  running: "running",
} as const;

export function pickFollowSession(
  rows: SessionListItem[],
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
  cursorColumn: number,
): Promise<string | undefined> {
  const sessions = rows
    .filter((row): row is SessionListItem & { status: "downloading" | "running" } => row.status === "running" || row.status === "downloading")
    .sort((a, b) => Number(a.status === "downloading") - Number(b.status === "downloading"));
  if (sessions.length === 0) {
    output.write("\r\nno running or pending sessions\r\n");
    return Promise.resolve(undefined);
  }

  let selected = 0;
  let drawn = false;
  const lineCount = sessions.length + 2;
  const previousKeypressListeners = input.listeners("keypress");
  const inputWasPaused = input.isPaused();
  for (const listener of previousKeypressListeners) {
    input.removeListener("keypress", listener);
  }

  const draw = (): void => {
    if (drawn) {
      output.write(`\x1b[${lineCount - 1}A\r`);
    } else {
      output.write("\x1b[?25l\r\n");
      drawn = true;
    }
    output.write("\x1b[2K  active sessions\r\n");
    for (const [index, session] of sessions.entries()) {
      const marker = index === selected ? "\x1b[36m›\x1b[0m" : " ";
      const status = `${STATUS_COLOR[session.status]}${STATUS_LABEL[session.status].padEnd(STATUS_WIDTH)}${RESET}`;
      output.write(`\x1b[2K${marker} ${status}  ${session.id}\r\n`);
    }
    output.write("\x1b[2K  ↑/↓ or tab navigate • enter select • esc cancel");
  };

  return new Promise((resolve) => {
    const finish = (sessionId: string | undefined): void => {
      input.pause();
      input.removeListener("keypress", onKeypress);
      for (const listener of previousKeypressListeners) {
        input.on("keypress", listener);
      }
      output.write("\r");
      for (let line = 0; line < lineCount; line++) {
        output.write("\x1b[2K");
        if (line < lineCount - 1) {
          output.write("\x1b[1A");
        }
      }
      output.write(`\x1b[1A\x1b[${cursorColumn + 1}G\x1b[?25h`);
      if (!inputWasPaused) {
        input.resume();
      }
      resolve(sessionId);
    };

    const onKeypress = (_text: string | undefined, key: Key): void => {
      if (key.name === "up" || (key.name === "tab" && key.shift)) {
        selected = (selected - 1 + sessions.length) % sessions.length;
        draw();
      } else if (key.name === "down" || key.name === "tab") {
        selected = (selected + 1) % sessions.length;
        draw();
      } else if (key.name === "return" || key.name === "enter") {
        finish(sessions[selected].id);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        finish(undefined);
      }
    };

    input.on("keypress", onKeypress);
    draw();
    input.resume();
  });
}
