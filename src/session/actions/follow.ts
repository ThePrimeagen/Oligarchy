import { createInterface } from "node:readline";
import { canPlaceImages, clearImages, placeImage } from "../../terminal/image.ts";
import { type Session, spawnClient } from "../client.ts";

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
const STATUS_COLOR: Record<Extract<FollowEvent, { type: "session" }>["status"], string> = {
  pending: GRAY,
  running: "\x1b[33m",
  succeeded: GREEN,
  failed: RED,
  aborted: "\x1b[91m",
  timed_out: "\x1b[35m",
};

type Entry = {
  id: number | "intent";
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
        view.entries.push({ id: "intent", name: event.message, state: "running" });
      } else {
        const open = view.entries.findLast((entry) => entry.id === "intent" && entry.state === "running");
        if (open !== undefined) {
          open.state = event.state === "completed" ? "completed" : "failed";
        }
      }
      break;
    case "action":
      if (event.state === "running") {
        view.entries.push({ id: event.id, name: event.name, state: "running" });
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
    const indent = entry.id === "intent" ? 0 : 2;
    const width = LEFT_COLS - 3 - indent;
    const label = entry.name.length > width ? `${entry.name.slice(0, width - 1)}…` : entry.name;
    const mark = entry.state === "running" ? `${GRAY}${glyph}` : entry.state === "completed" ? `${GREEN}✓` : `${RED}✗`;
    out += `${" ".repeat(indent)}${mark} ${label}${RESET}${" ".repeat(width - label.length)}`;
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

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  session.following = undefined;
  if (onScreen) {
    clearInterval(spinner);
    process.stdout.off("resize", redraw);
    clearImages();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }
  if (child.killed) {
    console.log(`detached from ${id}`);
  } else if (code === 0) {
    console.log(`session ${id} ${view.status}`);
  } else {
    console.log(Buffer.concat(err).toString("utf8").trim());
  }
}
