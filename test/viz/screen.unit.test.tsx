/** @jsxImportSource @opentui/solid */
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { ImageRenderable, type Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { Effect, Option } from "effect";
import type * as Servers from "../../src/db/servers.ts";
import * as Follow from "../../src/viz/follow.ts";
import * as Screen from "../../src/viz/screen.tsx";
import * as View from "../../src/viz/view.ts";
import * as FakeRenderer from "../support/fake-renderer.ts";
import {
  ago,
  at,
  attic,
  atticSeries,
  BLANK_GRAPH,
  blankBox,
  BLOCKS,
  BOLD,
  bottom,
  box,
  cells,
  COLUMNS,
  CPU_BOTTOM,
  CPU_TOP,
  diagnosing,
  divider,
  EMPTY_QUEUE,
  failed,
  FOOTER,
  garage,
  GARAGE_RIGHT,
  garageSeries,
  GOLD,
  GRAPH,
  header,
  IRIS,
  job,
  JOB_HEADER,
  JOBS_BOTTOM,
  JOBS_TOP,
  labels,
  LOVE,
  machinesTop,
  MEM_BOTTOM,
  MEM_TOP,
  mouse,
  MUTED,
  OPENED,
  pad,
  DIAGNOSING,
  PENDING,
  pending,
  PINE,
  PLAIN,
  QUEUE,
  QUERIED_AT,
  queueTop,
  READ_AT,
  ROWS,
  RUNNING,
  runner,
  running,
  screendump,
  sendKey,
  SESSION_ID,
  shown,
  SNAPSHOT,
  space,
  SUBTLE,
  TEXT,
  ticketOf,
  TINY_PNG,
  USABLE,
  values,
} from "../support/viz.ts";

const TABS = "servers 1/2 │ driving 1/1 diagnosing 0/1";

// The screen drawn once for a view at a size, as plain rows or as each row's styled spans.
const mounted = <A,>(
  view: View.View,
  now: number,
  columns: number,
  rows: number,
  read: (setup: Awaited<ReturnType<typeof testRender>>) => Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      testRender(() => <Screen.App view={() => view} now={() => now} />, {
        width: columns,
        height: rows,
      }),
    ),
    read,
    (setup) => Effect.sync(() => setup.renderer.destroy()),
  );
const draw = (
  view: View.View,
  now = READ_AT,
  columns = COLUMNS,
  rows = ROWS,
): Effect.Effect<ReadonlyArray<string>> => mounted(view, now, columns, rows, FakeRenderer.rows);
const styled = (
  view: View.View,
  now = READ_AT,
  columns = COLUMNS,
  rows = ROWS,
): Effect.Effect<ReadonlyArray<ReadonlyArray<FakeRenderer.Span>>> =>
  mounted(view, now, columns, rows, FakeRenderer.spans);

// The colour and attributes of the one run of cells drawn as `text` on a row.
const styleOf = (
  row: ReadonlyArray<FakeRenderer.Span> | undefined,
  text: string,
): readonly [color: string, attributes: number] => {
  const found = (row ?? []).find((span) => span[0] === text);
  if (found === undefined) {
    throw new Error(`no span "${text}" in ${JSON.stringify(row)}`);
  }
  return [found[1], found[2]];
};
const colorsOf = (row: ReadonlyArray<FakeRenderer.Span> | undefined): ReadonlyArray<string> =>
  (row ?? []).map((span) => span[1]);
const textOf = (row: ReadonlyArray<FakeRenderer.Span> | undefined): string =>
  (row ?? []).map((span) => span[0]).join("");

const imageProtocols = (node: Renderable): ReadonlyArray<string> => [
  ...(node instanceof ImageRenderable ? [node.protocol] : []),
  ...node.getChildren().flatMap(imageProtocols),
];

describe("screen happy path", () => {
  it.effect("fills every row of the terminal, each as wide as the terminal", () =>
    Effect.gen(function* () {
      const rows = yield* draw(shown(SNAPSHOT));
      expect(rows).toHaveLength(ROWS);
      for (const row of rows) {
        expect(row).toHaveLength(COLUMNS);
      }
    }),
  );

  it.effect(
    "boxes the qemu servers as cards under the tabs with their graphs and the jobs running on them, then the live queue, and ends with the key hints",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(shown(SNAPSHOT));
        expect(rows[0]).toBe(machinesTop("read 0 s ago"));
        expect(rows[1]).toBe(box(TABS));
        expect(rows[2]).toBe(box("  s  automation"));
        expect(rows[3]).toBe(box("▸ qemu servers"));
        expect(rows[4]).toBe(box("  t  tickets"));
        expect(rows[5]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(rows[6]).toBe(box(labels(CPU_TOP, MEM_TOP, JOBS_TOP)));
        expect(rows[7]).toBe(
          box(values("37.5%", CPU_BOTTOM, "512 MB", MEM_BOTTOM, "2", JOBS_BOTTOM)),
        );
        expect(rows[8]).toBe(box(job(" ", RUNNING)));
        expect(rows[9]).toBe(divider);
        expect(rows[10]).toBe(box(header("  — · https://qemu-c.example.com", "never heard from")));
        expect(rows[11]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
        expect(rows[12]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
        expect(rows[13]).toBe(bottom());
        expect(rows[14]).toBe(queueTop("automation · running 1 · pending 1"));
        expect(rows[15]).toBe(box(JOB_HEADER));
        expect(rows[16]).toBe(box(job("▸", RUNNING)));
        expect(rows[17]).toBe(box(job(" ", PENDING)));
        for (const row of rows.slice(18, ROWS - 2)) {
          expect(row).toBe(blankBox);
        }
        expect(rows[ROWS - 2]).toBe(bottom());
        expect(rows[ROWS - 1]).toBe(FOOTER);
      }),
  );

  it.effect(
    "opens the automation tab as the clients and their jobs beside that client's memory and cpu",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(shown(SNAPSHOT, { tab: "automation" }));
        expect(rows[0]).toBe(machinesTop("read 0 s ago"));
        expect(rows[1]).toBe(box(TABS));
        expect(rows[2]).toBe(box("▸ s  automation"));
        expect(rows[3]).toBe(box("  qemu servers"));
        expect(rows[4]).toBe(box("  t  tickets"));
        expect(rows[5]).toContain("▸ runner");
        expect(rows[5]).toContain("256 MB");
        expect(rows[5]).toContain("8.0%");
        expect(rows[6]).toContain("OLI-61");
        expect(rows[6]).toContain("100%");
        // The graphs keep the top third. 0% is the last of those rows, not the foot of the body.
        expect(rows[14]).toContain("0%");
        expect(rows[15]).toContain("no session");
        expect(rows[ROWS - 2]).toBe(bottom());
        expect(rows[ROWS - 1]).toBe(FOOTER);
        expect(rows.join("\n")).not.toContain("╭─ automation");
        const spans = yield* styled(shown(SNAPSHOT, { tab: "automation" }));
        expect(styleOf(spans[5], "256 MB  ")).toEqual(["#9ccfd8", PLAIN]);
        expect(styleOf(spans[5], "8.0%   ")).toEqual([GOLD, PLAIN]);
      }),
  );

  it.effect(
    "lists on a card the running jobs placed on it by url: a drive on its qemu server and its client, a diagnose on its client alone, a pending job and a job on an unknown url on none",
    () =>
      Effect.gen(function* () {
        const elsewhere = {
          ...running,
          ticket: "OLI-66",
          clientUrl: "http://10.9.9.9:2",
          serverUrl: "http://10.9.9.9:1",
        };
        const snapshot: View.Snapshot = {
          ...SNAPSHOT,
          machines: [garage, runner],
          queue: { ...QUEUE, running: [running, diagnosing, elsewhere] },
        };
        const servers = yield* draw(shown(snapshot));
        expect(servers[8]).toBe(box(job(" ", RUNNING)));
        expect(servers[9]).toBe(bottom());
        expect(servers[10]).toBe(queueTop("automation · running 3 · pending 1"));
        const clients = yield* draw(shown(snapshot, { tab: "automation" }));
        const listed = clients.flatMap((row) => row.match(/OLI-\d+/g) ?? []);
        expect(listed).toEqual(["OLI-61", "OLI-65"]);
        expect(clients.join("\n")).not.toContain("OLI-66");
        expect(clients.join("\n")).not.toContain("OLI-62");
        expect(servers.filter((row) => row.includes("OLI-66"))).toHaveLength(1);
        expect(servers.filter((row) => row.includes("OLI-62"))).toHaveLength(1);
      }),
  );

  it.effect(
    "paints the borders and titles muted, the active tab bold, the focused list's marker gold and the other's muted, the cpu graph by heat, memory pine, jobs iris, and each job by its status",
    () =>
      Effect.gen(function* () {
        const rows = yield* styled(shown(SNAPSHOT));
        expect(rows[0]).toEqual([[machinesTop("read 0 s ago"), MUTED, PLAIN]]);
        // The separator shares the inactive tab's muted, so the two are one run of cells.
        expect(styleOf(rows[1], "servers 1/2")).toEqual([TEXT, BOLD]);
        expect(styleOf(rows[1], " │ driving 1/1 diagnosing 0/1")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[3], "▸ qemu servers")).toEqual([GOLD, BOLD]);
        expect(styleOf(rows[5], "▸")).toEqual([GOLD, PLAIN]);
        expect(styleOf(rows[5], "garage")).toEqual([TEXT, BOLD]);
        expect(styleOf(rows[5], "http://127.0.0.1:55332")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[5], "qemus")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[5], "12 s ago")).toEqual([TEXT, PLAIN]);
        // Eight of sixteen blocks lit for 31.5 of 66.9 GB, each its own shade, the rest muted.
        const blocks = (rows[5] ?? []).filter((span) => span[0].startsWith("■"));
        expect(blocks.map((span) => span[0])).toEqual([
          ...Array.from({ length: 8 }, () => "■"),
          "■".repeat(8),
        ]);
        expect(blocks[7]?.[1]).toBe(GOLD);
        expect(blocks[8]?.[1]).toBe(MUTED);
        expect(new Set(blocks.slice(0, 8).map((span) => span[1])).size).toBe(8);
        expect(styleOf(rows[6], "cpu     ")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[6], "⡇")).toEqual([LOVE, PLAIN]);
        expect(styleOf(rows[6], "⢀⣿⣿")).toEqual([PINE, PLAIN]);
        expect(styleOf(rows[6], "⣿⣿")).toEqual([IRIS, PLAIN]);
        expect(styleOf(rows[7], "   37.5%")).toEqual([TEXT, BOLD]);
        // The card's job, in the queue's look, with no marker of its own while the card is selected.
        expect(textOf(rows[8]).startsWith("│   OLI-61")).toBe(true);
        expect(styleOf(rows[8], pad(`${View.spinnerAt(READ_AT)} running`, 12))).toEqual([
          View.DRIVE_COLOR,
          PLAIN,
        ]);
        expect(rows[9]).toEqual([[divider, MUTED, PLAIN]]);
        expect(colorsOf(rows[10])).not.toContain(GOLD);
        expect(styleOf(rows[10], "never heard from")).toEqual([MUTED, PLAIN]);
        expect(rows[14]).toEqual([[queueTop("automation · running 1 · pending 1"), MUTED, PLAIN]]);
        expect(styleOf(rows[15], JOB_HEADER)).toEqual([SUBTLE, PLAIN]);
        // The machines have the focus: the queue's marker is muted, its ticket text.
        expect(styleOf(rows[16], "▸")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[16], pad("OLI-61", 9))).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[16], pad(`${View.spinnerAt(READ_AT)} running`, 12))).toEqual([
          View.DRIVE_COLOR,
          PLAIN,
        ]);
        expect(styleOf(rows[17], pad("◌ pending", 12))).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "j/k")).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[ROWS - 1], " select   ")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "q")).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "oligarchy")).toEqual([MUTED, PLAIN]);
        const queue = yield* styled(shown(SNAPSHOT, { focus: "queue" }));
        expect(styleOf(queue[5], "▸")).toEqual([MUTED, PLAIN]);
        expect(styleOf(queue[16], "▸")).toEqual([GOLD, PLAIN]);
        // The card's job selected: its marker gold, the card's header without one.
        const onJob = yield* styled(at(SNAPSHOT, { servers: 1 }));
        expect(textOf(onJob[5])).not.toContain("▸");
        expect(styleOf(onJob[8], "▸")).toEqual([GOLD, PLAIN]);
        const clients = yield* styled(shown(SNAPSHOT, { tab: "automation" }));
        expect(styleOf(clients[1], "servers 1/2 │ ")).toEqual([MUTED, PLAIN]);
        expect(styleOf(clients[1], "driving 1/1 diagnosing 0/1")).toEqual([TEXT, BOLD]);
      }),
  );

  it.effect(
    "colours the cpu graph from foam through gold to love as the reading climbs, one colour per column",
    () =>
      Effect.gen(function* () {
        const cpuRow = (readings: ReadonlyArray<number>) =>
          Effect.map(
            styled(
              shown({
                ...SNAPSHOT,
                machines: [garage],
                series: [
                  {
                    ...garageSeries,
                    samples: readings.map((cpuPercent) => ({
                      jobs: 0,
                      memoryBytes: 1,
                      cpuPercent,
                    })),
                  },
                ],
              }),
            ),
            (rows) => rows[7] ?? [],
          );
        // One percent is one dot, a shade off foam; fifty is gold itself; a hundred is love.
        expect(styleOf(yield* cpuRow([0, 1]), "⢀")).toEqual(["#9ecfd6", PLAIN]);
        expect(styleOf(yield* cpuRow([50, 50]), "⣿")).toEqual([GOLD, PLAIN]);
        expect(styleOf(yield* cpuRow([100, 100]), "⣿")).toEqual([LOVE, PLAIN]);
        // The first column at 25 sits between foam and gold; the second between gold and love.
        const two = yield* cpuRow([25, 25, 75, 75]);
        expect(styleOf(two, "⣤")).toEqual(["#c9c8a8", PLAIN]);
        expect(styleOf(two, "⣿")).toEqual(["#f19885", PLAIN]);
      }),
  );

  it.effect(
    "shows the newest readings that fit, and gives a wider terminal wider graphs and job rows as wide",
    () =>
      Effect.gen(function* () {
        const wide = 160;
        const graph = Math.floor((wide - 4 - 31) / 3);
        const rows = yield* draw(shown(SNAPSHOT), READ_AT, wide, ROWS);
        for (const row of rows) {
          expect(row).toHaveLength(wide);
        }
        expect(rows[0]).toBe(machinesTop("read 0 s ago", wide));
        expect(rows[6]).toBe(
          box(
            `${pad("cpu", 8)} ${space(graph - 2)}⢠⡇  ${pad("mem", 8)} ${space(graph - 3)}⢀⣿⣿  ${pad("jobs", 8)} ${space(graph - 2)}⣿⣿`,
            wide,
          ),
        );
        expect(rows[8]).toBe(box(job(" ", RUNNING), wide));
        expect(rows[15]).toBe(box(JOB_HEADER, wide));
        expect(rows[16]).toBe(box(job("▸", RUNNING), wide));
        // Ninety readings in a graph of thirty-three columns: the oldest twenty-four fall off.
        const long = Array.from({ length: 90 }, (_, index) => ({
          jobs: 0,
          memoryBytes: 1,
          cpuPercent: index < 24 ? 100 : 0,
        }));
        const cut = yield* draw(
          shown({ ...SNAPSHOT, machines: [garage], series: [{ ...garageSeries, samples: long }] }),
        );
        const full = "⣿".repeat(GRAPH);
        expect(cut[6]).toBe(box(labels(BLANK_GRAPH, full, BLANK_GRAPH)));
        expect(cut[7]).toBe(box(values("0.0%", BLANK_GRAPH, "0 MB", full, "0", BLANK_GRAPH)));
        // Memory and jobs scale to the highest reading in view, not to one that fell off.
        const spiked = [
          { jobs: 8, memoryBytes: 1, cpuPercent: 0 },
          ...Array.from({ length: 2 * GRAPH - 1 }, () => ({
            jobs: 0,
            memoryBytes: 1,
            cpuPercent: 0,
          })),
          { jobs: 1, memoryBytes: 1, cpuPercent: 0 },
        ];
        const scaled = yield* draw(
          shown({
            ...SNAPSHOT,
            machines: [garage],
            series: [{ ...garageSeries, samples: spiked }],
          }),
        );
        expect(scaled[6]).toBe(box(labels(BLANK_GRAPH, full, `${space(GRAPH - 1)}⢸`)));
        expect(scaled[7]).toBe(
          box(values("0.0%", BLANK_GRAPH, "0 MB", full, "1", `${space(GRAPH - 1)}⢸`)),
        );
      }),
  );

  it.effect("lists the jobs in the order given, running then pending, and nothing completed", () =>
    Effect.gen(function* () {
      const other = { ...pending, ticket: "OLI-70" };
      const rows = yield* draw(
        shown({
          ...SNAPSHOT,
          queue: {
            running: [running],
            pending: [other, pending],
            completed: [failed, { ...failed, ticket: "OLI-59", status: "succeeded" }],
          },
        }),
      );
      expect(rows.slice(16, 19).map(ticketOf)).toEqual(["OLI-61", "OLI-70", "OLI-62"]);
      expect(rows[19]).toBe(blankBox);
      expect(rows[14]).toBe(queueTop("automation · running 1 · pending 2"));
      // A completed job placed on garage is not on its card either.
      expect(rows[9]).toBe(divider);
      const frame = rows.join("\n");
      expect(frame).not.toContain("OLI-60");
      expect(frame).not.toContain("OLI-59");
      expect(frame).not.toContain("failed");
      expect(frame).not.toContain("session timed out");
    }),
  );
});

describe("screen selection", () => {
  const fleet = Array.from({ length: 6 }, (_, index) => ({
    ...garage,
    url: `http://10.0.0.${String(index)}`,
    name: `s${String(index)}`,
  }));
  const many: View.Snapshot = { ...SNAPSHOT, machines: [...fleet, runner], series: [] };
  const names = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
    rows.filter((row) => /^│ [▸ ] s\d/.test(row)).map((row) => row.slice(2, 6));
  // `count` running drives on every server of the fleet.
  const busy = (count: number): View.Snapshot => ({
    ...many,
    queue: {
      ...EMPTY_QUEUE,
      running: fleet.flatMap((machine, server) =>
        Array.from({ length: count }, (_, index) => ({
          ...running,
          ticket: `OLI-${String(server)}${String(index)}`,
          serverUrl: machine.url,
        })),
      ),
    },
  });

  it.effect(
    "shows four cards at most, the selected one marked, scrolls the window to keep it in view, and puts the window's place on the bottom border",
    () =>
      Effect.gen(function* () {
        const top = yield* draw(shown(many));
        expect(names(top)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
        expect(top[20]).toBe(bottom("1-4 of 6"));
        expect(top[21]).toBe(queueTop("automation · running 1 · pending 1"));
        const third = yield* draw(at(many, { servers: 3 }));
        expect(names(third)).toEqual(["  s0", "  s1", "  s2", "▸ s3"]);
        const fifth = yield* draw(at(many, { servers: 4 }));
        expect(names(fifth)).toEqual(["  s1", "  s2", "  s3", "▸ s4"]);
        expect(fifth[20]).toBe(bottom("2-5 of 6"));
        const last = yield* draw(at(many, { servers: 5 }));
        expect(names(last)).toEqual(["  s2", "  s3", "  s4", "▸ s5"]);
        expect(last[20]).toBe(bottom("3-6 of 6"));
        // Four or fewer: no window to speak of.
        const few = yield* draw(shown(SNAPSHOT));
        expect(few[13]).toBe(bottom());
      }),
  );

  it.effect(
    "shows only the cards that fit with their jobs, the queue keeping four rows, and cuts a card's jobs to the box",
    () =>
      Effect.gen(function* () {
        // Cards of seven rows: three fit in the twenty-three rows the box may take at 37 rows.
        const four = yield* draw(shown(busy(4)));
        expect(names(four)).toEqual(["▸ s0", "  s1", "  s2"]);
        expect(four[28]).toBe(bottom("1-3 of 6"));
        expect(four[29]).toBe(queueTop("automation · running 24 · pending 0"));
        expect(four[30]).toBe(box(JOB_HEADER));
        // Three cards of four jobs, then the four queue rows the shorter box leaves.
        expect(four.filter((row) => /^│ [▸ ] OLI-/.test(row))).toHaveLength(12 + 4);
        expect(four[35]).toBe(bottom("1-4 of 24"));
        expect(four[36]).toBe(FOOTER);
        // Cards of eleven rows: two fit.
        const eight = yield* draw(shown(busy(8)));
        expect(names(eight)).toEqual(["▸ s0", "  s1"]);
        expect(eight[28]).toBe(bottom("1-2 of 6"));
        // The window ends at the selected card and grows upward first: the last card's last
        // job selected shows the three cards above it that fit.
        const end = yield* draw(at(busy(4), { servers: 29 }));
        expect(names(end)).toEqual(["  s3", "  s4", "  s5"]);
        expect(
          end
            .slice(0, 28)
            .filter((row) => row.startsWith("│ ▸ OLI-"))
            .map(ticketOf),
        ).toEqual(["OLI-53"]);
        expect(end[28]).toBe(bottom("4-6 of 6"));
        // A taller terminal fits all four.
        const tall = yield* draw(shown(busy(4)), READ_AT, COLUMNS, 50);
        expect(names(tall)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
        expect(tall[36]).toBe(bottom("1-4 of 6"));
        // A server running more guests than the box has rows shows what fits and the queue keeps
        // its four rows; the frame is still the terminal's height.
        const crowded = yield* draw(shown(busy(30)));
        expect(crowded).toHaveLength(ROWS);
        for (const row of crowded) {
          expect(row).toHaveLength(COLUMNS);
        }
        expect(names(crowded)).toEqual(["▸ s0"]);
        expect(crowded.slice(8, 28).every((row) => row.startsWith("│   OLI-0"))).toBe(true);
        expect(crowded[28]).toBe(bottom("1-1 of 6"));
        expect(crowded[29]).toBe(queueTop("automation · running 180 · pending 0"));
        expect(crowded[35]).toBe(bottom("1-4 of 180"));
        expect(crowded[36]).toBe(FOOTER);
        // The twenty-sixth job of that server selected (the card's header is the first entry):
        // the card's window ends on it, so the job L opens is on screen and marked.
        const deep = yield* draw(at(busy(30), { servers: 26 }));
        expect(deep.slice(8, 28).map(ticketOf)).toEqual(
          Array.from({ length: 20 }, (_, index) => `OLI-0${String(index + 6)}`),
        );
        expect(
          deep
            .slice(8, 28)
            .filter((row) => row.startsWith("│ ▸ "))
            .map(ticketOf),
        ).toEqual(["OLI-025"]);
        expect(deep[5]?.startsWith("│   s0")).toBe(true);
        expect(deep[28]).toBe(bottom("1-1 of 6"));
      }),
  );

  it.effect("clamps a cursor past the end to the last row, and one below zero to the first", () =>
    Effect.gen(function* () {
      const past = yield* draw(at(many, { servers: 40 }));
      expect(names(past)).toEqual(["  s2", "  s3", "  s4", "▸ s5"]);
      const below = yield* draw(at(many, { servers: -3 }));
      expect(names(below)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
    }),
  );

  it.effect(
    "marks the selected job, scrolls the job window to keep it in view, and puts the window's place on the queue's bottom border",
    () =>
      Effect.gen(function* () {
        const jobs = Array.from({ length: 40 }, (_, index) => ({
          ...pending,
          ticket: `OLI-${String(100 + index)}`,
        }));
        const snapshot = { ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs } };
        const marked = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
          rows.filter((row) => row.startsWith("│ ▸ OLI-")).map(ticketOf);
        const listed = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
          rows.filter((row) => /^│ [▸ ] OLI-/.test(row)).map(ticketOf);
        // 37 rows: the cards' box grew by the three tabs, so twenty jobs fit under them.
        const first = yield* draw(shown(snapshot));
        expect(listed(first)).toHaveLength(20);
        expect(listed(first)[0]).toBe("OLI-100");
        expect(marked(first)).toEqual(["OLI-100"]);
        expect(first[35]).toBe(bottom("1-20 of 40"));
        const within = yield* draw(at(snapshot, { queue: 10 }));
        expect(listed(within)[0]).toBe("OLI-100");
        expect(marked(within)).toEqual(["OLI-110"]);
        const scrolled = yield* draw(at(snapshot, { queue: 30 }));
        expect(listed(scrolled)[0]).toBe("OLI-111");
        expect(listed(scrolled).at(-1)).toBe("OLI-130");
        expect(marked(scrolled)).toEqual(["OLI-130"]);
        expect(scrolled[35]).toBe(bottom("12-31 of 40"));
        const end = yield* draw(at(snapshot, { queue: 39 }));
        expect(listed(end)).toHaveLength(20);
        expect(marked(end)).toEqual(["OLI-139"]);
        expect(end[35]).toBe(bottom("21-40 of 40"));
        // A cursor past the end marks the last job; a taller terminal lists more.
        const past = yield* draw(at(snapshot, { queue: 90 }), READ_AT, COLUMNS, 50);
        expect(past).toHaveLength(50);
        expect(listed(past)).toHaveLength(33);
        expect(marked(past)).toEqual(["OLI-139"]);
        expect(past[48]).toBe(bottom("8-40 of 40"));
        expect(past[49]).toBe(FOOTER);
        const exact = yield* draw(
          shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs.slice(0, 23) } }),
        );
        expect(exact[35]).toBe(bottom("1-20 of 23"));
      }),
  );

  it.effect("draws the selection j and k moved: a card's job marked, the header unmarked", () =>
    Effect.gen(function* () {
      const snapshot: View.Snapshot = {
        ...SNAPSHOT,
        queue: { ...QUEUE, running: [running, diagnosing] },
      };
      const onJob = yield* draw(at(snapshot, { servers: 1 }));
      expect(onJob[5]?.startsWith("│   garage")).toBe(true);
      expect(onJob[8]).toBe(box(job("▸", RUNNING)));
      expect(onJob[10]?.startsWith("│   — ·")).toBe(true);
      const next = yield* draw(at(snapshot, { servers: 2 }));
      expect(next[8]).toBe(box(job(" ", RUNNING)));
      expect(next[10]?.startsWith("│ ▸ — ·")).toBe(true);
      const clients = yield* draw(
        shown(snapshot, { tab: "automation", cursor: { servers: 0, clients: 2, queue: 0 } }),
      );
      expect(clients[5]).toContain("runner");
      expect(clients[5]).not.toContain("▸");
      expect(clients[7]).toContain("▸");
      expect(clients[7]).toContain("OLI-65");
      // A job that finished under the cursor: the rows above take the selection.
      const gone = yield* draw(
        shown(SNAPSHOT, { tab: "automation", cursor: { servers: 0, clients: 2, queue: 0 } }),
      );
      expect(gone[6]).toContain("▸");
      expect(gone[6]).toContain("OLI-61");
      // The queue focused with its second job selected, the machines keeping their place.
      const three = {
        ...SNAPSHOT,
        queue: { ...QUEUE, pending: [{ ...pending, ticket: "OLI-70" }, pending] },
      };
      const queued = yield* draw(
        shown(three, { focus: "queue", cursor: { servers: 2, clients: 0, queue: 1 } }),
      );
      expect(queued[5]?.startsWith("│   garage")).toBe(true);
      expect(queued[10]?.startsWith("│ ▸ — ·")).toBe(true);
      expect(queued.slice(16, 19).map((row) => row.slice(2, 3))).toEqual([" ", "▸", " "]);
    }),
  );
});

describe("screen ages", () => {
  it.effect(
    "reads a stamp's age in the unit an operator would: seconds, minutes, hours, days",
    () =>
      Effect.gen(function* () {
        const heard = (secondsAgo: number): Servers.Machine => ({
          ...garage,
          url: `http://s${String(secondsAgo)}`,
          heartbeatAt: ago(secondsAgo),
        });
        const seen = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
          rows
            .filter((row) => row.includes("seen "))
            .map((row) => row.slice(row.indexOf("seen ") + 5, -2).trimEnd());
        expect(
          seen(
            yield* draw(
              shown({ ...SNAPSHOT, machines: [heard(0), heard(59), heard(60), heard(3_599)] }),
            ),
          ),
        ).toEqual(["0 s ago", "59 s ago", "1 min ago", "59 min ago"]);
        // An hour and a day are silent, so the age follows the word.
        const old = yield* draw(shown({ ...SNAPSHOT, machines: [heard(3_600), heard(90_000)] }));
        expect(old[5]).toContain("silent · seen 1 h ago");
        expect(old[9]).toContain("silent · seen 1 d ago");
      }),
  );

  it.effect("adds the time since the read to every age, and says how old the read itself is", () =>
    Effect.gen(function* () {
      const rows = yield* draw(shown(SNAPSHOT), READ_AT + 3_000);
      expect(rows[0]).toBe(machinesTop("read 3 s ago"));
      expect(rows[5]).toContain("seen 15 s ago");
      expect(rows[8]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      expect(rows[16]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      const later = yield* draw(shown(SNAPSHOT), READ_AT + 125_000);
      expect(later[0]).toBe(machinesTop("read 2 min ago"));
    }),
  );

  it.effect("never reads a stamp the database wrote just ahead of its clock as negative", () =>
    Effect.gen(function* () {
      const ahead: Servers.Machine = { ...garage, heartbeatAt: ago(-2) };
      const rows = yield* draw(shown({ ...SNAPSHOT, machines: [ahead] }));
      expect(rows[5]).toContain("seen 0 s ago");
    }),
  );
});

describe("screen unhappy path", () => {
  it.effect(
    "marks a machine silent once three heartbeats are overdue, its host numbers withheld and its graphs muted",
    () =>
      Effect.gen(function* () {
        const view = shown({ ...SNAPSHOT, machines: [attic], series: [atticSeries] });
        const rows = yield* draw(view);
        expect(rows[5]).toBe(
          box(header("▸ attic · https://qemu-b.example.com", "silent · seen 5 min ago")),
        );
        expect(rows[6]).toBe(
          box(labels(BLANK_GRAPH, `${space(GRAPH - 1)}⢸`, `${space(GRAPH - 1)}⢸`)),
        );
        expect(rows[7]).toBe(
          box(
            values(
              "50.0%",
              `${space(GRAPH - 1)}⢸`,
              "1.0 GB",
              `${space(GRAPH - 1)}⢸`,
              "3",
              `${space(GRAPH - 1)}⢸`,
            ),
          ),
        );
        const frame = rows.join("\n");
        expect(frame).not.toContain("50.0%  host");
        expect(frame).not.toContain("4.0 / 16.0 GB");
        const spans = yield* styled(view);
        expect(styleOf(spans[5], "silent · seen 5 min ago")).toEqual([LOVE, PLAIN]);
        const dots = [...(spans[6] ?? []), ...(spans[7] ?? [])].filter((span) => span[0] === "⢸");
        expect(dots).toHaveLength(5);
        expect(dots.every((span) => span[1] === MUTED)).toBe(true);
        expect(colorsOf(spans[6])).not.toContain(PINE);
        expect(colorsOf(spans[7])).not.toContain(IRIS);
        expect(styleOf(spans[7], "   50.0%")).toEqual([MUTED, PLAIN]);
      }),
  );

  it.effect(
    "is not silent at ninety seconds and is at ninety-one, the read's own age included",
    () =>
      Effect.gen(function* () {
        const heard = (secondsAgo: number) => ({
          ...SNAPSHOT,
          machines: [{ ...garage, heartbeatAt: ago(secondsAgo) }],
        });
        expect((yield* draw(shown(heard(90))))[5]).toContain("31.5 / 66.9 GB");
        expect((yield* draw(shown(heard(91))))[5]).toContain("silent · seen 1 min ago");
        expect((yield* draw(shown(heard(88)), READ_AT + 3_000))[5]).toContain(
          "silent · seen 1 min ago",
        );
      }),
  );

  it.effect("draws a live machine without readings with dashes and empty graphs", () =>
    Effect.gen(function* () {
      const rows = yield* draw(shown({ ...SNAPSHOT, machines: [garage], series: [] }));
      expect(rows[5]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
      expect(rows[6]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
      expect(rows[7]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
      // A client's readings never dress a server of the same name.
      const crossed = yield* draw(
        shown({
          ...SNAPSHOT,
          machines: [garage],
          series: [{ ...garageSeries, type: "automation-client" }],
        }),
      );
      expect(crossed[7]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
    }),
  );

  it.effect(
    "counts a client once per kind, and ignores a running job whose client is not listed",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(
          shown({
            ...SNAPSHOT,
            queue: {
              ...EMPTY_QUEUE,
              running: [
                running,
                { ...running, ticket: "OLI-70" },
                diagnosing,
                { ...diagnosing, ticket: "OLI-71", clientUrl: "http://missing.example" },
              ],
            },
          }),
        );
        expect(rows[1]).toBe(box("servers 1/2 │ driving 1/1 diagnosing 1/1"));
      }),
  );

  it.effect("says so in a tab with no machines, and gives the queue the rows", () =>
    Effect.gen(function* () {
      const servers = yield* draw(shown({ ...SNAPSHOT, machines: [runner] }));
      expect(servers[0]).toBe(machinesTop("read 0 s ago"));
      expect(servers[1]).toBe(box("servers 0/0 │ driving 1/1 diagnosing 0/1"));
      expect(servers[5]).toBe(box("no qemu servers registered"));
      expect(servers[6]).toBe(bottom());
      expect(servers[7]).toBe(queueTop("automation · running 1 · pending 1"));
      expect(servers[9]).toBe(box(job("▸", RUNNING)));
      const clients = yield* draw(
        shown({ ...SNAPSHOT, machines: [garage] }, { tab: "automation" }),
      );
      expect(clients[5]).toBe(box("no automation clients"));
      const spans = yield* styled(shown({ ...SNAPSHOT, machines: [] }));
      expect(styleOf(spans[5], "no qemu servers registered")).toEqual([MUTED, PLAIN]);
    }),
  );

  it.effect(
    "says so under the queue's header with nothing to list, marks nothing, and counts zero",
    () =>
      Effect.gen(function* () {
        const view = shown({ ...SNAPSHOT, queue: EMPTY_QUEUE }, { focus: "queue" });
        const rows = yield* draw(view);
        expect(rows[13]).toBe(queueTop("automation · running 0 · pending 0"));
        expect(rows[14]).toBe(box(JOB_HEADER));
        expect(rows[15]).toBe(box("no jobs"));
        expect(rows[16]).toBe(blankBox);
        const spans = yield* styled(view);
        // The machines' own marker stays, muted; nothing in the focused queue is marked.
        expect(spans.flat().filter((span) => span[0] === "▸")).toEqual([["▸", MUTED, PLAIN]]);
        expect(styleOf(spans[15], "no jobs")).toEqual([MUTED, PLAIN]);
      }),
  );

  it.effect("shows a dash for a job whose result has no ticket yet", () =>
    Effect.gen(function* () {
      const rows = yield* draw(
        shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: [{ ...pending, ticket: null }] } }),
      );
      expect(rows[15]?.startsWith(`│ ▸ ${cells(pad("—", 9), pad("install", 18))}`)).toBe(true);
    }),
  );

  it.effect("truncates a name, a url and a test to their columns with an ellipsis", () =>
    Effect.gen(function* () {
      const long = "a".repeat(80);
      const rows = yield* draw(
        shown({
          ...SNAPSHOT,
          machines: [{ ...garage, name: long, url: `http://${long}.example.com` }],
          series: [],
          queue: {
            ...EMPTY_QUEUE,
            running: [{ ...running, test: long, serverUrl: `http://${long}.example.com` }],
          },
        }),
      );
      const left = USABLE - GARAGE_RIGHT.length - 2;
      expect(rows[5]).toBe(box(header(`▸ ${long.slice(0, left - 3)}…`, GARAGE_RIGHT)));
      const truncated = [
        "OLI-61",
        `${"a".repeat(17)}…`,
        "45 s ago",
        `${View.spinnerAt(READ_AT)} running`,
        "3 min ago",
        "45 s ago",
      ] as const;
      expect(rows[8]).toBe(box(job(" ", truncated)));
      expect(rows[12]).toBe(box(job("▸", truncated)));
      for (const row of rows) {
        expect(row).toHaveLength(COLUMNS);
      }
    }),
  );

  it.effect(
    "draws a test name that spans lines or carries an escape, and a failure that does, as one row each",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw({
          ...shown({
            ...SNAPSHOT,
            queue: {
              ...EMPTY_QUEUE,
              running: [{ ...running, test: "one\ntwo\x1b[31m\tt\u007f\u009bc" }],
            },
          }),
          failure: Option.some("Failed query: select 1\nparams: []"),
        });
        expect(rows).toHaveLength(ROWS);
        for (const row of rows) {
          expect(row).toHaveLength(COLUMNS);
          expect(row).not.toContain("\t");
          expect(row).not.toContain("\u009b");
          expect(row).not.toContain("\x1b");
        }
        const cleaned = [
          "OLI-61",
          "one two [31m t  c",
          "45 s ago",
          `${View.spinnerAt(READ_AT)} running`,
          "3 min ago",
          "45 s ago",
        ] as const;
        expect(rows[8]).toBe(box(job(" ", cleaned)));
        expect(rows[16]).toBe(box(job("▸", cleaned)));
        expect(rows[ROWS - 1]).toBe(pad(" error: Failed query: select 1 params: []", COLUMNS));
      }),
  );

  it.effect("draws the empty boxes and the tabs before the first read has landed", () =>
    Effect.gen(function* () {
      const rows = yield* draw(View.initialView);
      expect(rows[0]).toBe(machinesTop("reading…"));
      expect(rows[1]).toBe(box("servers │ driving diagnosing"));
      expect(rows[2]).toBe(box("▸ s  automation"));
      expect(rows[3]).toBe(box("  qemu servers"));
      expect(rows[4]).toBe(box("  t  tickets"));
      expect(rows[ROWS - 2]).toBe(bottom());
      expect(rows[ROWS - 1]).toBe(FOOTER);
      const spans = yield* styled(View.initialView);
      expect(styleOf(spans[1], "driving diagnosing")).toEqual([TEXT, BOLD]);
      expect(styleOf(spans[2], "▸ s  automation")).toEqual([GOLD, BOLD]);
    }),
  );

  it.effect("puts a failed read's reason on the footer and keeps the last snapshot on screen", () =>
    Effect.gen(function* () {
      const reason = "Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432";
      const view = { ...shown(SNAPSHOT), failure: Option.some(reason) };
      const rows = yield* draw(view, READ_AT + 7_000);
      expect(rows[0]).toBe(machinesTop("read 7 s ago"));
      expect(rows[5]).toContain("http://127.0.0.1:55332");
      expect(rows[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
      expect(rows.join("\n")).not.toContain("q quit");
      const spans = yield* styled(view, READ_AT + 7_000);
      expect(styleOf(spans[ROWS - 1], `error: ${reason}`)).toEqual([LOVE, PLAIN]);
      const bare = yield* draw({ ...View.initialView, failure: Option.some(reason) });
      expect(bare[0]).toBe(machinesTop("reading…"));
      expect(bare[1]).toBe(box("servers │ driving diagnosing"));
      expect(bare[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
    }),
  );

  it.effect("puts the last key's notice on the footer in gold, under a read's failure", () =>
    Effect.gen(function* () {
      const notice = "opened https://linear.app/issue/OLI-61";
      const view = { ...shown(SNAPSHOT), notice: Option.some(notice) };
      const rows = yield* draw(view);
      expect(rows[ROWS - 1]).toBe(OPENED);
      expect(rows.join("\n")).not.toContain("q quit");
      const spans = yield* styled(view);
      expect(styleOf(spans[ROWS - 1], notice)).toEqual([GOLD, PLAIN]);
      const reason = "Failed query: select 1";
      const both = yield* draw({
        ...shown(SNAPSHOT),
        notice: Option.some(notice),
        failure: Option.some(reason),
      });
      expect(both[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
      const cut = yield* draw({
        ...shown(SNAPSHOT),
        notice: Option.some(`xdg-open: ${"x".repeat(200)}`),
      });
      expect(cut[ROWS - 1]).toBe(` xdg-open: ${"x".repeat(COLUMNS - 13)}… `);
    }),
  );

  it.effect(
    "draws no follow while none is open: no peek box, no image, and the F hint in the footer",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(shown(SNAPSHOT));
        expect(rows.join("\n")).not.toContain("follow OLI-61");
        expect(rows.some((row) => BLOCKS.test(row))).toBe(false);
        expect(rows[ROWS - 1]).toContain("F follow");
      }),
  );

  it.effect("names the size it needs, and nothing else, when the terminal is too small", () =>
    Effect.gen(function* () {
      const narrow = yield* draw(shown(SNAPSHOT), READ_AT, 134, 37);
      expect(narrow[0]).toBe(pad(View.tooSmall(134, 37), 134));
      expect(narrow.slice(1).every((row) => row.trim() === "")).toBe(true);
      const short = yield* draw(shown(SNAPSHOT), READ_AT, 135, 36);
      expect(short[0]).toBe(pad(View.tooSmall(135, 36), 135));
      expect(short).toHaveLength(36);
      const spans = yield* styled(shown(SNAPSHOT), READ_AT, 134, 37);
      expect(styleOf(spans[0], View.tooSmall(134, 37))).toEqual([LOVE, PLAIN]);
      expect((yield* draw(shown(SNAPSHOT), READ_AT, 135, 37)).join("\n")).not.toContain(
        "viz needs",
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// Follow: a peek over the bottom of the board, or the whole screen
// ---------------------------------------------------------------------------

describe("screen follow", () => {
  const peek = Follow.peekFromActions(
    "OLI-61",
    SESSION_ID,
    garage.url,
    [
      { request: sendKey, createdAt: ago(20) },
      { request: mouse, createdAt: ago(8) },
      { request: screendump, createdAt: ago(2) },
    ],
    Option.some(TINY_PNG),
  );
  // The peek's rows: the five above the footer.
  const PEEK_TOP = ROWS - 1 - Follow.PEEK_FRAME_ROWS;
  const PEEK_TITLE = "follow OLI-61 · 7a2d0000";
  const command = (name: string, age: string): string =>
    `${name.padEnd(Follow.LEFT_COLS - age.length - 2)}  ${age}`;
  // A command's age counts from the local clock, so here the read lands on the database's
  // clock and the screen is drawn at that instant.
  const QUERIED_AT_MS = QUERIED_AT.getTime();
  const AT_READ: View.Snapshot = { ...SNAPSHOT, readAt: QUERIED_AT_MS };
  const peeking = (follow: Follow.Follow, view: Partial<View.View> = {}): View.View =>
    shown(AT_READ, { follow: Option.some(follow), ...view });

  it.effect(
    "a peek boxes the last three commands with their ages over the bottom of the board, the last image beside them, the keys on its border, and leaves the footer",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(peeking(peek), QUERIED_AT_MS);
        expect(rows).toHaveLength(ROWS);
        // The board above is untouched.
        expect(rows[0]).toBe(machinesTop("read 0 s ago"));
        expect(rows[5]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(rows[PEEK_TOP]).toBe(queueTop(PEEK_TITLE));
        expect(rows[PEEK_TOP + 1]?.startsWith(`│ ${command("screendump", "2 s ago")}`)).toBe(true);
        expect(rows[PEEK_TOP + 2]?.startsWith(`│ ${command("input-send-event", "8 s ago")}`)).toBe(
          true,
        );
        expect(rows[PEEK_TOP + 3]?.startsWith(`│ ${command("send-key", "20 s ago")}`)).toBe(true);
        for (const row of rows.slice(PEEK_TOP + 1, PEEK_TOP + 4)) {
          expect(row.endsWith(" │")).toBe(true);
          // The image, drawn as blocks here, sits to the right of the commands.
          expect(BLOCKS.test(row.slice(Follow.LEFT_COLS + 2))).toBe(true);
          expect(BLOCKS.test(row.slice(0, Follow.LEFT_COLS + 2))).toBe(false);
        }
        expect(rows[PEEK_TOP + 4]).toBe(bottom(Follow.PEEK_HINT));
        expect(rows[ROWS - 1]).toBe(FOOTER);
        expect(rows.slice(0, PEEK_TOP).some((row) => BLOCKS.test(row))).toBe(false);
        const spans = yield* styled(peeking(peek), QUERIED_AT_MS);
        expect(styleOf(spans[PEEK_TOP], ` ${PEEK_TITLE} `)).toEqual([TEXT, PLAIN]);
        // The name is padded to where the age starts, so its run of cells carries the padding.
        expect(
          styleOf(
            spans[PEEK_TOP + 1],
            "screendump".padEnd(Follow.LEFT_COLS - "2 s ago".length - 2),
          ),
        ).toEqual([TEXT, PLAIN]);
        expect(styleOf(spans[PEEK_TOP + 1], "2 s ago")).toEqual([SUBTLE, PLAIN]);
      }),
  );

  it.effect(
    "a screenshot is drawn as blocks in its cell box, on a kitty host and on any other",
    () =>
      Effect.gen(function* () {
        const kitty = yield* Effect.promise(() =>
          testRender(
            () => (
              <Screen.App
                view={() => peeking(peek)}
                now={() => QUERIED_AT_MS}
                imageProtocol="kitty"
              />
            ),
            { width: COLUMNS, height: ROWS },
          ),
        );
        yield* Effect.promise(() => kitty.renderOnce());
        expect(imageProtocols(kitty.renderer.root)).toEqual(["blocks"]);
        kitty.renderer.destroy();

        const plain = yield* Effect.promise(() =>
          testRender(
            () => (
              <Screen.App
                view={() => peeking(peek)}
                now={() => QUERIED_AT_MS}
                imageProtocol="auto"
              />
            ),
            { width: COLUMNS, height: ROWS },
          ),
        );
        const rows = yield* Effect.promise(() => plain.renderOnce()).pipe(
          Effect.map(() => plain.captureCharFrame().replace(/\n$/, "").split("\n")),
        );
        expect(imageProtocols(plain.renderer.root)).toEqual(["blocks"]);
        expect(BLOCKS.test(rows[PEEK_TOP + 1]?.slice(Follow.LEFT_COLS + 2) ?? "")).toBe(true);
        plain.renderer.destroy();
      }),
  );

  it.effect("a peek with no commands and no image says so and shows nothing beside it", () =>
    Effect.gen(function* () {
      const empty = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
      const rows = yield* draw(peeking(empty), QUERIED_AT_MS);
      expect(rows[PEEK_TOP]).toBe(queueTop(PEEK_TITLE));
      expect(rows[PEEK_TOP + 1]).toBe(box("no commands yet"));
      expect(rows[PEEK_TOP + 2]).toBe(blankBox);
      expect(rows[PEEK_TOP + 3]).toBe(blankBox);
      expect(rows[PEEK_TOP + 4]).toBe(bottom(Follow.PEEK_HINT));
      expect(rows.some((row) => BLOCKS.test(row))).toBe(false);
      const spans = yield* styled(peeking(empty), QUERIED_AT_MS);
      expect(styleOf(spans[PEEK_TOP + 1], "no commands yet")).toEqual([MUTED, PLAIN]);
    }),
  );

  it.effect(
    "a full follow takes the screen: the ticket and status head it, the entries with their marks run down the left, the live image fills the right, and esc closes",
    () =>
      Effect.gen(function* () {
        const full = Follow.apply(
          Follow.apply(Follow.expand(peek, garage.url), { type: "session", status: "running" }),
          { type: "action", id: 9, name: "mouse-click", state: "running" },
        );
        const rows = yield* draw(peeking(full));
        expect(rows).toHaveLength(ROWS);
        expect(rows[0]).toBe(pad(" following OLI-61 · 7a2d0000 running", COLUMNS));
        expect(rows[1]?.startsWith(` ${Follow.SPINNER[0]} mouse-click`)).toBe(true);
        expect(rows[2]?.startsWith(" ✓ screendump")).toBe(true);
        expect(rows[3]?.startsWith(" ✓ input-send-event")).toBe(true);
        expect(rows[4]?.startsWith(" ✓ send-key")).toBe(true);
        expect(rows[5]?.slice(0, Follow.LEFT_COLS).trim()).toBe("");
        // The image fills the rows to the right of the entries.
        expect(BLOCKS.test(rows[1]?.slice(Follow.LEFT_COLS) ?? "")).toBe(true);
        expect(BLOCKS.test(rows[20]?.slice(Follow.LEFT_COLS) ?? "")).toBe(true);
        expect(
          rows.slice(1, ROWS - 1).every((row) => !BLOCKS.test(row.slice(0, Follow.LEFT_COLS))),
        ).toBe(true);
        expect(rows[ROWS - 1]).toBe(pad(" esc closes", COLUMNS));
        // Nothing of the board remains.
        expect(rows.join("\n")).not.toContain("qemu servers");
        expect(rows.join("\n")).not.toContain("automation ·");
        const spans = yield* styled(peeking(full));
        expect(styleOf(spans[0], "running")).toEqual([GOLD, PLAIN]);
        expect(styleOf(spans[2], "✓")).toEqual([Follow.SUCCESS, PLAIN]);
        expect(styleOf(spans[2], "screendump")).toEqual([Follow.SUCCESS, PLAIN]);
        expect(styleOf(spans[1], Follow.SPINNER[0] ?? "")).toEqual([GOLD, PLAIN]);
        expect(styleOf(spans[ROWS - 1], "esc closes")).toEqual([MUTED, PLAIN]);
        // The spinner turns with the frame; a failed action gets a red cross.
        const later = yield* draw(peeking(Follow.tick(full)));
        expect(later[1]?.startsWith(` ${Follow.SPINNER[1]} mouse-click`)).toBe(true);
        const failedRows = yield* styled(
          peeking(Follow.apply(full, { type: "action", id: 9, state: "failed" })),
        );
        expect(styleOf(failedRows[1], "✗")).toEqual([LOVE, PLAIN]);
      }),
  );

  it.effect(
    "a full follow shows the newest entries that fit, a notice on its last row over the closing hint, and no image before one arrives",
    () =>
      Effect.gen(function* () {
        const bare = Follow.expand(
          Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
          garage.url,
        );
        let busy = Follow.apply(bare, { type: "session", status: "running" });
        for (let id = 0; id < 50; id += 1) {
          busy = Follow.apply(busy, { type: "action", id, name: "send-keys", state: "running" });
        }
        const rows = yield* draw(
          peeking(busy, { notice: Option.some("dropped from x: this follower fell behind") }),
        );
        // Header and footer leave 35 rows: the newest 35 of the 50, none of the peek's.
        expect(rows[1]?.startsWith(` ${Follow.SPINNER[0]} send-keys`)).toBe(true);
        expect(rows[ROWS - 2]?.startsWith(` ${Follow.SPINNER[0]} send-keys`)).toBe(true);
        expect(rows.slice(1, ROWS - 1).filter((row) => row.includes("send-keys"))).toHaveLength(35);
        expect(rows.join("\n")).not.toContain("✓");
        expect(rows[ROWS - 1]).toBe(pad(" dropped from x: this follower fell behind", COLUMNS));
        expect(rows.some((row) => BLOCKS.test(row))).toBe(false);
        // A dirty intent is drawn as one clean row.
        const dirty = Follow.apply(bare, {
          type: "intent",
          state: "started",
          message: "wait\nfor\x1b[31mthe boot",
        });
        const cleaned = yield* draw(peeking(dirty));
        expect(cleaned).toHaveLength(ROWS);
        expect(cleaned[1]?.startsWith(` ${Follow.SPINNER[0]} wait for [31mthe boot`)).toBe(true);
        expect(cleaned[0]).toBe(pad(" following OLI-61 · 7a2d0000 pending", COLUMNS));
        const spans = yield* styled(peeking(dirty));
        expect(styleOf(spans[0], "pending")).toEqual([MUTED, PLAIN]);
      }),
  );
});

describe("screen pop-up", () => {
  const popup = Option.some({ text: View.CANNOT_ABORT, shownAt: READ_AT });
  // The sentence, two cells of padding either side and the border: five rows in the middle of
  // the screen.
  const WIDTH = View.CANNOT_ABORT.length + 6;
  const LEFT = Math.floor((COLUMNS - WIDTH) / 2);
  const TOP = Math.floor((ROWS - 5) / 2);
  const TOP_BORDER = `╭${"─".repeat(WIDTH - 2)}╮`;
  const BOTTOM_BORDER = `╰${"─".repeat(WIDTH - 2)}╯`;
  const BLANK = `│${space(WIDTH - 2)}│`;
  const SENTENCE = `│  ${View.CANNOT_ABORT}  │`;
  const within = (row: string | undefined): string => (row ?? "").slice(LEFT, LEFT + WIDTH);

  it.effect(
    "a pop-up boxes its sentence in the middle of the board, over the rows it covers alone, in love",
    () =>
      Effect.gen(function* () {
        const plain = yield* draw(shown(SNAPSHOT));
        const rows = yield* draw(shown(SNAPSHOT, { popup }));
        expect(rows).toHaveLength(ROWS);
        expect(within(rows[TOP])).toBe(TOP_BORDER);
        expect(within(rows[TOP + 1])).toBe(BLANK);
        expect(within(rows[TOP + 2])).toBe(SENTENCE);
        expect(within(rows[TOP + 3])).toBe(BLANK);
        expect(within(rows[TOP + 4])).toBe(BOTTOM_BORDER);
        // The board shows on either side of the box and above and below it.
        for (let index = TOP; index <= TOP + 4; index += 1) {
          expect(rows[index]?.slice(0, LEFT)).toBe(plain[index]?.slice(0, LEFT));
          expect(rows[index]?.slice(LEFT + WIDTH)).toBe(plain[index]?.slice(LEFT + WIDTH));
        }
        expect(rows.slice(0, TOP)).toEqual(plain.slice(0, TOP));
        expect(rows.slice(TOP + 5)).toEqual(plain.slice(TOP + 5));
        expect(rows[ROWS - 1]).toBe(FOOTER);
        const spans = yield* styled(shown(SNAPSHOT, { popup }));
        expect(styleOf(spans[TOP], TOP_BORDER)).toEqual([LOVE, PLAIN]);
        expect(styleOf(spans[TOP + 4], BOTTOM_BORDER)).toEqual([LOVE, PLAIN]);
        expect(styleOf(spans[TOP + 2], View.CANNOT_ABORT)).toEqual([TEXT, PLAIN]);
      }),
  );

  it.effect("a pop-up lies over a full follow too, and no box is drawn without one", () =>
    Effect.gen(function* () {
      const full = Follow.apply(
        Follow.expand(
          Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
          garage.url,
        ),
        { type: "session", status: "running" },
      );
      const rows = yield* draw(shown(SNAPSHOT, { follow: Option.some(full), popup }));
      expect(rows[0]).toBe(pad(" following OLI-61 · 7a2d0000 running", COLUMNS));
      expect(within(rows[TOP])).toBe(TOP_BORDER);
      expect(within(rows[TOP + 2])).toBe(SENTENCE);
      expect(within(rows[TOP + 4])).toBe(BOTTOM_BORDER);
      expect(rows[ROWS - 1]).toBe(pad(" esc closes", COLUMNS));
      const without = yield* draw(shown(SNAPSHOT));
      expect(without.join("\n")).not.toContain(View.CANNOT_ABORT);
      expect(within(without[TOP])).not.toBe(TOP_BORDER);
    }),
  );
});

describe("screen confirm", () => {
  const asked: View.Confirm = { ticket: "OLI-61", action: "drive", choice: "no" };
  // The question's box: its fixed width in the middle of the screen (a half column goes to the
  // right, as the layout rounds), seven rows tall (the border, a row of padding, the question,
  // a blank, the answers, padding, the border).
  const WIDTH = View.CONFIRM_WIDTH;
  const LEFT = Math.round((COLUMNS - WIDTH) / 2);
  const TOP = Math.floor((ROWS - 7) / 2);
  const within = (row: string | undefined): string => (row ?? "").slice(LEFT, LEFT + WIDTH);
  const asking = (confirm: View.Confirm, view: Partial<View.View> = {}): View.View =>
    shown(SNAPSHOT, { confirm: Option.some(confirm), ...view });

  it.effect(
    "the question boxes the job's name, are you sure and the two answers in the middle of the board, the keys on its border, the marker on no",
    () =>
      Effect.gen(function* () {
        const plain = yield* draw(shown(SNAPSHOT));
        const rows = yield* draw(asking(asked));
        expect(rows).toHaveLength(ROWS);
        expect(within(rows[TOP])).toBe(queueTop("abort drive OLI-61", WIDTH));
        expect(within(rows[TOP + 1])).toBe(box("", WIDTH));
        expect(within(rows[TOP + 2])).toBe(box("are you sure?", WIDTH));
        expect(within(rows[TOP + 3])).toBe(box("", WIDTH));
        expect(within(rows[TOP + 4])).toBe(box("  yes    ▸ no", WIDTH));
        expect(within(rows[TOP + 5])).toBe(box("", WIDTH));
        expect(within(rows[TOP + 6])).toBe(bottom(View.CONFIRM_HINT, WIDTH));
        // The board shows on either side of the box and above and below it.
        for (let index = TOP; index <= TOP + 6; index += 1) {
          expect(rows[index]?.slice(0, LEFT)).toBe(plain[index]?.slice(0, LEFT));
          expect(rows[index]?.slice(LEFT + WIDTH)).toBe(plain[index]?.slice(LEFT + WIDTH));
        }
        expect(rows.slice(0, TOP)).toEqual(plain.slice(0, TOP));
        expect(rows.slice(TOP + 7)).toEqual(plain.slice(TOP + 7));
        expect(rows[ROWS - 1]).toBe(FOOTER);
        const spans = yield* styled(asking(asked));
        expect(styleOf(spans[TOP], " abort drive OLI-61 ")).toEqual([TEXT, PLAIN]);
        expect(styleOf(spans[TOP + 2], "are you sure?")).toEqual([TEXT, PLAIN]);
        expect(styleOf(spans[TOP + 4], "  yes")).toEqual([MUTED, PLAIN]);
        expect(styleOf(spans[TOP + 4], "▸ no")).toEqual([GOLD, BOLD]);
        expect(styleOf(spans[TOP + 6], ` ${View.CONFIRM_HINT} `)).toEqual([TEXT, PLAIN]);
        expect(colorsOf(spans[TOP])).toContain(GOLD);
      }),
  );

  it.effect(
    "the marker follows the answer, the question lies over a peek and under a pop-up, and no box is drawn without one",
    () =>
      Effect.gen(function* () {
        const yes = yield* draw(asking({ ...asked, choice: "yes" }));
        expect(within(yes[TOP + 4])).toBe(box("▸ yes      no", WIDTH));
        const spans = yield* styled(asking({ ...asked, choice: "yes" }));
        expect(styleOf(spans[TOP + 4], "▸ yes")).toEqual([GOLD, BOLD]);
        expect(styleOf(spans[TOP + 4], "  no")).toEqual([MUTED, PLAIN]);
        // Over a peek: the peek's frame is still there below the question.
        const peek = Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none());
        const overPeek = yield* draw(asking(asked, { follow: Option.some(peek) }));
        expect(within(overPeek[TOP])).toBe(queueTop("abort drive OLI-61", WIDTH));
        expect(overPeek[ROWS - 1 - Follow.PEEK_FRAME_ROWS]).toBe(
          queueTop("follow OLI-61 · 7a2d0000"),
        );
        // Under a pop-up: the pop-up's sentence covers the question's middle rows.
        const popup = Option.some({ text: View.CANNOT_ABORT, shownAt: READ_AT });
        const underPopup = yield* draw(asking(asked, { popup }));
        expect(within(underPopup[TOP])).toBe(queueTop("abort drive OLI-61", WIDTH));
        expect(underPopup.some((row) => row.includes(`│  ${View.CANNOT_ABORT}  │`))).toBe(true);
        const without = yield* draw(shown(SNAPSHOT));
        expect(without.join("\n")).not.toContain("are you sure?");
      }),
  );
});

describe("running job rows", () => {
  const status = (now: number): string => pad(`${View.spinnerAt(now)} running`, 12);
  const strip = (row: string | undefined): string => (row ?? "").slice(2, 28);
  const withBoth = (snapshot: View.Snapshot = SNAPSHOT): View.Snapshot => ({
    ...snapshot,
    queue: { ...snapshot.queue, running: [running, diagnosing] },
  });

  it.effect(
    "paints a running drive green, with the spinner and how long it has run in place of the action word",
    () =>
      Effect.gen(function* () {
        const rows = yield* styled(shown(SNAPSHOT));
        const elapsed = pad("45 s ago", 10);
        for (const index of [8, 16]) {
          expect(styleOf(rows[index], status(READ_AT))).toEqual([View.DRIVE_COLOR, PLAIN]);
          expect(styleOf(rows[index], elapsed)).toEqual([View.DRIVE_COLOR, PLAIN]);
          expect(styleOf(rows[index], pad("45 s ago", 11))).toEqual([SUBTLE, PLAIN]);
          expect(textOf(rows[index])).not.toContain("drive");
        }
        const tickets = yield* draw(shown(SNAPSHOT, { tab: "tickets" }));
        expect(tickets[5]).toBe(box(JOB_HEADER));
        expect(tickets[6]).toBe(box(job("▸", RUNNING)));
        const clients = yield* draw(shown(SNAPSHOT, { tab: "automation" }));
        expect(strip(clients[6])).toContain(View.spinnerAt(READ_AT));
        expect(strip(clients[6])).toContain("45 s ago");
        expect(strip(clients[6])).not.toContain("drive");
        const painted = yield* styled(shown(SNAPSHOT, { tab: "automation" }));
        expect(styleOf(painted[6], View.spinnerAt(READ_AT))).toEqual([View.DRIVE_COLOR, PLAIN]);
        expect(styleOf(painted[6], "45 s ago")).toEqual([View.DRIVE_COLOR, PLAIN]);
      }),
  );

  it.effect(
    "paints a running diagnose blue, and drops the action word on the queue, the client and the tickets",
    () =>
      Effect.gen(function* () {
        const snapshot = withBoth();
        const queue = yield* styled(shown(snapshot));
        const diagnose = queue.find((row) => textOf(row).includes("OLI-65"));
        expect(styleOf(diagnose, status(READ_AT))).toEqual([View.DIAGNOSE_COLOR, PLAIN]);
        expect(styleOf(diagnose, pad("45 s ago", 10))).toEqual([View.DIAGNOSE_COLOR, PLAIN]);
        expect(textOf(diagnose)).not.toContain("diagnose");
        const clients = yield* styled(shown(snapshot, { tab: "automation" }));
        const client = clients.find((row) => textOf(row).includes("OLI-65"));
        expect(styleOf(client, View.spinnerAt(READ_AT))).toEqual([View.DIAGNOSE_COLOR, PLAIN]);
        expect(styleOf(client, "45 s ago")).toEqual([View.DIAGNOSE_COLOR, PLAIN]);
        expect(textOf(client)).not.toContain("diagnose");
        const tickets = yield* draw(shown(snapshot, { tab: "tickets" }));
        expect(tickets[7]).toBe(box(job(" ", DIAGNOSING)));
        expect(tickets[7]).not.toContain("diagnose");
      }),
  );

  it.effect("a pending row keeps the action word and the hollow mark, and spins nothing", () =>
    Effect.gen(function* () {
      const rows = yield* styled(shown(SNAPSHOT));
      expect(styleOf(rows[17], pad("drive", 10))).toEqual([SUBTLE, PLAIN]);
      expect(styleOf(rows[17], pad("◌ pending", 12))).toEqual([MUTED, PLAIN]);
      expect(textOf(rows[17])).toContain("drive");
      expect(textOf(rows[17])).not.toContain(View.spinnerAt(READ_AT));
      const drawn = yield* draw(shown(SNAPSHOT));
      expect(drawn[17]).toBe(box(job(" ", PENDING)));
    }),
  );

  it.effect("a finished ticket keeps the action word and is not spun", () =>
    Effect.gen(function* () {
      const rows = yield* draw(
        shown(
          { ...SNAPSHOT, queue: { running: [], pending: [], completed: [failed] } },
          { tab: "tickets" },
        ),
      );
      const finished = rows[6] ?? "";
      expect(finished).toContain("OLI-60");
      expect(finished).toContain("drive");
      expect(finished).toContain("◌ failed");
      expect(finished).not.toContain(View.spinnerAt(READ_AT));
    }),
  );

  it.effect("a running job that has not recorded a start shows a dash beside the spinner", () =>
    Effect.gen(function* () {
      const snapshot: View.Snapshot = {
        ...SNAPSHOT,
        queue: { ...EMPTY_QUEUE, running: [{ ...running, startedAt: null }] },
      };
      const rows = yield* styled(shown(snapshot));
      expect(styleOf(rows[8], status(READ_AT))).toEqual([View.DRIVE_COLOR, PLAIN]);
      expect(styleOf(rows[8], pad("—", 10))).toEqual([View.DRIVE_COLOR, PLAIN]);
      expect(textOf(rows[8])).not.toContain("drive");
      const clients = yield* draw(shown(snapshot, { tab: "automation" }));
      expect(strip(clients[6])).toContain("—");
      expect(strip(clients[6])).toContain(View.spinnerAt(READ_AT));
      expect(strip(clients[6])).not.toContain("drive");
    }),
  );

  it.effect("the next 80 milliseconds show the next glyph and the same elapsed age", () =>
    Effect.gen(function* () {
      const later = READ_AT + View.SPIN_MS;
      const rows = yield* styled(shown(SNAPSHOT), later);
      expect(View.spinnerAt(later)).not.toBe(View.spinnerAt(READ_AT));
      expect(styleOf(rows[16], status(later))).toEqual([View.DRIVE_COLOR, PLAIN]);
      expect(styleOf(rows[16], pad("45 s ago", 10))).toEqual([View.DRIVE_COLOR, PLAIN]);
    }),
  );

  it.effect("fifty-nine minutes of running still fits the action column, uncut", () =>
    Effect.gen(function* () {
      const rows = yield* styled(
        shown({
          ...SNAPSHOT,
          queue: { ...EMPTY_QUEUE, running: [{ ...running, startedAt: ago(59 * 60) }] },
        }),
      );
      expect(styleOf(rows[16], pad("59 min ago", 10))).toEqual([View.DRIVE_COLOR, PLAIN]);
      expect(textOf(rows[16])).not.toContain("…");
      expect(textOf(rows[16])).not.toContain("drive");
    }),
  );
});

describe("session pane", () => {
  const sessionOf = (
    follow: Follow.Follow,
    note: Option.Option<string> = Option.none(),
  ): View.View => ({
    ...shown(SNAPSHOT, { tab: "automation" }),
    session: Option.some(follow),
    sessionNote: note,
  });

  it.effect(
    "the bottom two thirds is the selected ticket's session: the calls, the intent and the image",
    () =>
      Effect.gen(function* () {
        const full = Follow.apply(
          Follow.apply(
            Follow.expand(
              Follow.peekFromActions(
                "OLI-61",
                SESSION_ID,
                garage.url,
                [{ request: sendKey, createdAt: ago(2) }],
                Option.some(TINY_PNG),
              ),
              garage.url,
            ),
            { type: "intent", state: "started", message: "lock the screen" },
          ),
          { type: "action", id: 10, name: "send-keys", state: "running" },
        );
        const view = sessionOf(full);
        const rows = yield* draw(view);
        expect(rows[15]).toContain("following OLI-61");
        expect(rows.join("\n")).toContain("lock the screen");
        expect(rows.join("\n")).toContain("send-keys");
        expect(rows.join("\n")).toContain("send-key");
        const drawn = View.screen(view, READ_AT, COLUMNS, ROWS);
        const image = Option.getOrThrow(drawn.image);
        // Under the six-row log, across the main content, above the frame.
        expect(image).toEqual({ png: TINY_PNG, top: 21, height: 14, left: 31, width: 102 });
        const blockAt = rows.flatMap((row, index) => {
          const column = row.search(BLOCKS);
          return column < 0 ? [] : [[index, column] as const];
        });
        expect(blockAt.length).toBeGreaterThan(0);
        for (const [index, column] of blockAt) {
          expect(index).toBeGreaterThanOrEqual(image.top);
          expect(index).toBeLessThan(image.top + image.height);
          expect(column).toBeGreaterThanOrEqual(image.left);
          expect(column).toBeLessThan(image.left + image.width);
        }
        expect(rows.slice(0, image.top).some((row) => BLOCKS.test(row))).toBe(false);
        expect(rows.slice(15, image.top).join("\n")).toContain("lock the screen");
        // A kitty host gets a direct placement in that box, above the text. Anywhere else, nothing.
        const over = Screen.imageOverlay(view, READ_AT, COLUMNS, ROWS, true);
        expect(over.startsWith(`\x1b7\x1b_Ga=d,d=A,q=2\x1b\\`)).toBe(true);
        expect(over.endsWith("\x1b8")).toBe(true);
        expect(over).toContain(",z=1,");
        const cursor = over.indexOf("\x1b[");
        const held = over.indexOf("H", cursor);
        const [rowText, colText] = over.slice(cursor + 2, held).split(";");
        const row = Number(rowText);
        const col = Number(colText);
        expect(row).toBeGreaterThanOrEqual(image.top + 1);
        expect(row).toBeLessThanOrEqual(image.top + image.height);
        expect(col).toBeGreaterThanOrEqual(image.left + 1);
        expect(col).toBeLessThanOrEqual(image.left + image.width);
        expect(Screen.imageOverlay(view, READ_AT, COLUMNS, ROWS, false)).toBe("");
        const quiet = `\x1b7\x1b_Ga=d,d=A,q=2\x1b\\\x1b8`;
        const sheet: View.Sheet = { title: "definition", lines: ["one"], offset: 0 };
        expect(
          Screen.imageOverlay({ ...view, sheet: Option.some(sheet) }, READ_AT, COLUMNS, ROWS, true),
        ).toBe(quiet);
        expect(Screen.imageOverlay(view, READ_AT, 100, 24, true)).toBe(quiet);
        const covered = {
          ...view,
          follow: Option.some(
            Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
          ),
        };
        const inset = Option.getOrThrow(View.screen(covered, READ_AT, COLUMNS, ROWS).image);
        expect(inset.top).toBe(image.top);
        expect(inset.height).toBe(10);
        expect(inset.top + inset.height).toBe(ROWS - 1 - Follow.PEEK_FRAME_ROWS);
      }),
  );

  it.effect(
    "on a ticket the pane shows the step, the exact line, and that intent's actions, not the history",
    () =>
      Effect.gen(function* () {
        const instruction = `<ActionList>
* Press Super+Escape. The System menu opens.
* Click Lock. Use the mouse only. The screen locks.
* any crashes or erroneous behavior must be reported.
* always take a screen shot of every step
</ActionList>`;
        const full = Follow.apply(
          Follow.apply(
            Follow.expand(
              Follow.peekFromActions(
                "OLI-61",
                SESSION_ID,
                garage.url,
                [{ request: sendKey, createdAt: ago(2) }],
                Option.some(TINY_PNG),
              ),
              garage.url,
            ),
            {
              type: "intent",
              state: "started",
              message: "Click Lock. Use the mouse only. The screen locks.",
            },
          ),
          { type: "action", id: 10, name: "send-keys", state: "running" },
        );
        const view = sessionOf(full, Option.none());
        const onTicket = {
          ...view,
          snapshot: Option.some({
            ...SNAPSHOT,
            queue: {
              ...SNAPSHOT.queue,
              running: [{ ...running, instruction, intent: null }],
            },
          }),
          cursor: { ...view.cursor, clients: 1 },
        };
        const rows = yield* draw(onTicket);
        const body = rows.join("\n");
        expect(body).toContain("following OLI-61");
        expect(body).toContain("2/2");
        expect(body).toContain("Click Lock. Use the mouse only. The");
        expect(body).toContain("screen locks.");
        expect(body).toContain("send-keys");
        expect(body).not.toMatch(/send-key(?!s)/);
      }),
  );

  it.effect("a running client shows its step in place of how long it has run", () =>
    Effect.gen(function* () {
      const instruction = `<ActionList>
* Press Super+Escape. The System menu opens.
* Click Lock. Use the mouse only. The screen locks.
* any crashes or erroneous behavior must be reported.
* always take a screen shot of every step
</ActionList>`;
      const stepped = {
        ...running,
        instruction,
        intent: "Press Super+Escape. The System menu opens.",
      };
      const drawn = yield* draw(
        shown(
          { ...SNAPSHOT, queue: { ...EMPTY_QUEUE, running: [stepped] } },
          { tab: "automation" },
        ),
      );
      const side = (row: string | undefined): string => (row ?? "").slice(2, 28);
      expect(side(drawn[6])).toContain("1/2");
      expect(side(drawn[6])).not.toContain("45 s ago");
      const tickets = yield* draw(
        shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, running: [stepped] } }, { tab: "tickets" }),
      );
      expect(tickets.join("\n")).toContain("1/2");
    }),
  );

  it.effect("a paraphrase or a closed stream keeps the elapsed time (unhappy)", () =>
    Effect.gen(function* () {
      const instruction = `<ActionList>
* Press Super+Escape. The System menu opens.
* any crashes or erroneous behavior must be reported.
* always take a screen shot of every step
</ActionList>`;
      const paraphrased = { ...running, instruction, intent: "lock the screen" };
      const clients = yield* draw(
        shown(
          { ...SNAPSHOT, queue: { ...EMPTY_QUEUE, running: [paraphrased] } },
          { tab: "automation" },
        ),
      );
      const side = (row: string | undefined): string => (row ?? "").slice(2, 28);
      expect(side(clients[6])).toContain("45 s ago");
      expect(side(clients[6])).not.toContain("1/1");
      const done = Follow.apply(
        Follow.apply(
          Follow.expand(
            Follow.peekFromActions("OLI-61", SESSION_ID, garage.url, [], Option.none()),
            garage.url,
          ),
          { type: "session", status: "running" },
        ),
        { type: "intent", state: "completed" },
      );
      const selected = yield* draw(
        shown(
          {
            ...SNAPSHOT,
            queue: {
              ...EMPTY_QUEUE,
              running: [{ ...paraphrased, intent: "Press Super+Escape. The System menu opens." }],
            },
          },
          {
            tab: "automation",
            session: Option.some(done),
            cursor: { servers: 0, clients: 1, queue: 0 },
          },
        ),
      );
      expect(side(selected[6])).toContain("45 s ago");
    }),
  );

  it.effect("with no session the pane says so and draws no image (unhappy)", () =>
    Effect.gen(function* () {
      const waiting = {
        ...shown(SNAPSHOT, { tab: "automation" }),
        sessionNote: Option.some("waiting for OLI-61's session"),
      };
      const rows = yield* draw(waiting);
      expect(rows[15]).toContain("waiting for OLI-61's session");
      expect(rows.some((row) => BLOCKS.test(row))).toBe(false);
      expect(View.screen(waiting, READ_AT, COLUMNS, ROWS).image).toEqual(Option.none());
      expect(Screen.imageOverlay(waiting, READ_AT, COLUMNS, ROWS, true)).toBe(
        "\x1b7\x1b_Ga=d,d=A,q=2\x1b\\\x1b8",
      );
      const bare = yield* draw(shown(SNAPSHOT, { tab: "automation" }));
      expect(bare[15]).toContain("no session");
      expect(bare.some((row) => BLOCKS.test(row))).toBe(false);
    }),
  );

  it.effect("d's definition and enter's ticket information are drawn over the board", () =>
    Effect.gen(function* () {
      const defined = yield* draw({
        ...shown(SNAPSHOT, { tab: "automation" }),
        sheet: Option.some(
          View.definitionSheet({
            name: "lock-screen",
            description: "The screen locks.",
            instruction: "Lock it.",
            proof: "It is locked.",
          }),
        ),
      });
      expect(defined.join("\n")).toContain("lock-screen");
      expect(defined.join("\n")).toContain("The screen locks.");
      expect(defined.join("\n")).toContain(View.SHEET_HINT);
      expect(defined.join("\n")).toContain("OLI-61");

      const informed = yield* draw({
        ...shown(SNAPSHOT, { tab: "automation" }),
        sheet: Option.some(View.infoSheet(running, 0)),
      });
      expect(informed.join("\n")).toContain("ticket    OLI-61");
      expect(informed.join("\n")).toContain("reason    —");
      expect(informed.join("\n")).toContain(View.SHEET_HINT);
    }),
  );
});
