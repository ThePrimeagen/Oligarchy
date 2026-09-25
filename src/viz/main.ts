import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import * as Env from "@oligarchy/env/run";
import * as Api from "@oligarchy/routes/api";
import * as Image from "../session/image.ts";
import * as VizCommand from "./command.ts";
import * as Run from "./run.ts";
import * as Settings from "./settings.ts";

// Outside tmux, OpenTUI places a screenshot itself. Inside tmux the screen pins it to
// placeholder cells, and the placement is an APC tmux drops unless passthrough is on.
// The client's termtype is who draws; the session's TERM only names tmux. Run when
// the screen opens, not at load, so --help and a refused start change nothing.
const imageProtocol = Effect.sync((): Run.ImageDraw => {
  if (process.env.TMUX === undefined) {
    return "auto";
  }
  const asked = spawnSync("tmux", ["display-message", "-p", "#{client_termtype}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (
    asked.status !== 0 ||
    typeof asked.stdout !== "string" ||
    !Image.speaksKitty(asked.stdout.trim())
  ) {
    return "auto";
  }
  const set = spawnSync("tmux", ["set", "allow-passthrough", "on"], { stdio: "ignore" });
  if (set.status !== 0) {
    return "auto";
  }
  // The explicit-width probe false-positives inside tmux, and OSC 66 around U+10EEEE makes the
  // host draw a blank cell instead of the screenshot. Read when the screen opens.
  process.env.OPENTUI_FORCE_EXPLICIT_WIDTH = "false";
  return "kitty";
});

// One write, so a placement and its payload cannot be split by a short write.
const writeTerminal = (sequence: string): void => {
  writeSync(1, sequence);
};

// NodeServices brings the Terminal, for stdout's size before the screen is opened, and the
// spawner for xdg-open; the Renderer is OpenTUI's, which owns stdin and stdout while it runs.
const tickets = Layer.unwrap(
  Effect.map(Settings.load, (settings) => Layer.succeed(Settings.Tickets, settings.tickets)),
);

const MainLive = Layer.mergeAll(
  NodeHttpClient.layerNodeHttp,
  Run.Renderer.layer(imageProtocol, writeTerminal),
  tickets,
);

// SIGTERM interrupts the root fiber and the view's scope hands the screen back; ctrl-c arrives as
// a key in raw mode and ends the view the same way q does.
Env.run(Env.program(VizCommand.makeVizCommand(), { version: Api.VERSION, layer: MainLive }));
