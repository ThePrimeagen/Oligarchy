/** @jsxImportSource @opentui/solid */
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { testRender } from "@opentui/solid";
import { Effect, Option } from "effect";
import type * as Servers from "../../src/db/servers.ts";
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
  BOLD,
  bottom,
  box,
  cells,
  COLUMNS,
  CPU_BOTTOM,
  CPU_TOP,
  DIAGNOSING,
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
  MUTED,
  OPENED,
  pad,
  PENDING,
  pending,
  PINE,
  PLAIN,
  QUEUE,
  queueTop,
  READ_AT,
  ROWS,
  RUNNER_RIGHT,
  RUNNING,
  runner,
  running,
  shown,
  SNAPSHOT,
  space,
  SUBTLE,
  TEXT,
  ticketOf,
  USABLE,
  values,
} from "../support/viz.ts";

const TABS = "qemu servers · 2 │ automation clients · 1";

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
        expect(rows[2]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
        expect(rows[3]).toBe(box(labels(CPU_TOP, MEM_TOP, JOBS_TOP)));
        expect(rows[4]).toBe(
          box(values("37.5%", CPU_BOTTOM, "512 MB", MEM_BOTTOM, "2", JOBS_BOTTOM)),
        );
        expect(rows[5]).toBe(box(job(" ", RUNNING)));
        expect(rows[6]).toBe(divider);
        expect(rows[7]).toBe(box(header("  — · https://qemu-c.example.com", "never heard from")));
        expect(rows[8]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
        expect(rows[9]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
        expect(rows[10]).toBe(bottom());
        expect(rows[11]).toBe(queueTop("automation · running 1 · pending 1"));
        expect(rows[12]).toBe(box(JOB_HEADER));
        expect(rows[13]).toBe(box(job("▸", RUNNING)));
        expect(rows[14]).toBe(box(job(" ", PENDING)));
        for (const row of rows.slice(15, ROWS - 2)) {
          expect(row).toBe(blankBox);
        }
        expect(rows[ROWS - 2]).toBe(bottom());
        expect(rows[ROWS - 1]).toBe(FOOTER);
      }),
  );

  it.effect(
    "shows the automation clients on the other tab, with the same card and the jobs the client runs",
    () =>
      Effect.gen(function* () {
        const rows = yield* draw(shown(SNAPSHOT, { tab: "clients" }));
        expect(rows[0]).toBe(machinesTop("read 0 s ago"));
        expect(rows[1]).toBe(box(TABS));
        expect(rows[2]).toBe(box(header("▸ runner · http://10.0.0.9:7000", RUNNER_RIGHT)));
        // One reading: the left half of the one column is empty; 8% is one dot of the bottom row.
        expect(rows[3]).toBe(
          box(labels(BLANK_GRAPH, `${space(GRAPH - 1)}⢸`, `${space(GRAPH - 1)}⢸`)),
        );
        expect(rows[4]).toBe(
          box(
            values(
              "8.0%",
              `${space(GRAPH - 1)}⢀`,
              "256 MB",
              `${space(GRAPH - 1)}⢸`,
              "1",
              `${space(GRAPH - 1)}⢸`,
            ),
          ),
        );
        expect(rows[5]).toBe(box(job(" ", RUNNING)));
        expect(rows[6]).toBe(bottom());
        expect(rows[7]).toBe(queueTop("automation · running 1 · pending 1"));
        expect(rows[9]).toBe(box(job("▸", RUNNING)));
        expect(rows[ROWS - 1]).toBe(FOOTER);
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
        expect(servers[5]).toBe(box(job(" ", RUNNING)));
        expect(servers[6]).toBe(bottom());
        expect(servers[7]).toBe(queueTop("automation · running 3 · pending 1"));
        const clients = yield* draw(shown(snapshot, { tab: "clients" }));
        expect(clients[5]).toBe(box(job(" ", RUNNING)));
        expect(clients[6]).toBe(box(job(" ", DIAGNOSING)));
        expect(clients[7]).toBe(bottom());
        // The queue lists all three; the cards list only what is theirs.
        expect(clients.slice(10, 14).map(ticketOf)).toEqual([
          "OLI-61",
          "OLI-65",
          "OLI-66",
          "OLI-62",
        ]);
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
        expect(styleOf(rows[1], "qemu servers · 2")).toEqual([TEXT, BOLD]);
        expect(styleOf(rows[1], " │ automation clients · 1")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[2], "▸")).toEqual([GOLD, PLAIN]);
        expect(styleOf(rows[2], "garage")).toEqual([TEXT, BOLD]);
        expect(styleOf(rows[2], "http://127.0.0.1:55332")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[2], "qemus")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[2], "12 s ago")).toEqual([TEXT, PLAIN]);
        // Eight of sixteen blocks lit for 31.5 of 66.9 GB, each its own shade, the rest muted.
        const blocks = (rows[2] ?? []).filter((span) => span[0].startsWith("■"));
        expect(blocks.map((span) => span[0])).toEqual([
          ...Array.from({ length: 8 }, () => "■"),
          "■".repeat(8),
        ]);
        expect(blocks[7]?.[1]).toBe(GOLD);
        expect(blocks[8]?.[1]).toBe(MUTED);
        expect(new Set(blocks.slice(0, 8).map((span) => span[1])).size).toBe(8);
        expect(styleOf(rows[3], "cpu     ")).toEqual([SUBTLE, PLAIN]);
        expect(styleOf(rows[3], "⡇")).toEqual([LOVE, PLAIN]);
        expect(styleOf(rows[3], "⢀⣿⣿")).toEqual([PINE, PLAIN]);
        expect(styleOf(rows[3], "⣿⣿")).toEqual([IRIS, PLAIN]);
        expect(styleOf(rows[4], "   37.5%")).toEqual([TEXT, BOLD]);
        // The card's job, in the queue's look, with no marker of its own while the card is selected.
        expect(textOf(rows[5]).startsWith("│   OLI-61")).toBe(true);
        expect(styleOf(rows[5], pad("● running", 12))).toEqual([GOLD, PLAIN]);
        expect(rows[6]).toEqual([[divider, MUTED, PLAIN]]);
        expect(colorsOf(rows[7])).not.toContain(GOLD);
        expect(styleOf(rows[7], "never heard from")).toEqual([MUTED, PLAIN]);
        expect(rows[11]).toEqual([[queueTop("automation · running 1 · pending 1"), MUTED, PLAIN]]);
        expect(styleOf(rows[12], JOB_HEADER)).toEqual([SUBTLE, PLAIN]);
        // The machines have the focus: the queue's marker is muted, its ticket text.
        expect(styleOf(rows[13], "▸")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[13], pad("OLI-61", 9))).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[13], pad("● running", 12))).toEqual([GOLD, PLAIN]);
        expect(styleOf(rows[14], pad("◌ pending", 12))).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "j/k")).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[ROWS - 1], " select   ")).toEqual([MUTED, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "q")).toEqual([TEXT, PLAIN]);
        expect(styleOf(rows[ROWS - 1], "oligarchy")).toEqual([MUTED, PLAIN]);
        const queue = yield* styled(shown(SNAPSHOT, { focus: "queue" }));
        expect(styleOf(queue[2], "▸")).toEqual([MUTED, PLAIN]);
        expect(styleOf(queue[13], "▸")).toEqual([GOLD, PLAIN]);
        // The card's job selected: its marker gold, the card's header without one.
        const onJob = yield* styled(at(SNAPSHOT, { servers: 1 }));
        expect(textOf(onJob[2])).not.toContain("▸");
        expect(styleOf(onJob[5], "▸")).toEqual([GOLD, PLAIN]);
        const clients = yield* styled(shown(SNAPSHOT, { tab: "clients" }));
        expect(styleOf(clients[1], "qemu servers · 2 │ ")).toEqual([MUTED, PLAIN]);
        expect(styleOf(clients[1], "automation clients · 1")).toEqual([TEXT, BOLD]);
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
            (rows) => rows[4] ?? [],
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
        expect(rows[3]).toBe(
          box(
            `${pad("cpu", 8)} ${space(graph - 2)}⢠⡇  ${pad("mem", 8)} ${space(graph - 3)}⢀⣿⣿  ${pad("jobs", 8)} ${space(graph - 2)}⣿⣿`,
            wide,
          ),
        );
        expect(rows[5]).toBe(box(job(" ", RUNNING), wide));
        expect(rows[12]).toBe(box(JOB_HEADER, wide));
        expect(rows[13]).toBe(box(job("▸", RUNNING), wide));
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
        expect(cut[3]).toBe(box(labels(BLANK_GRAPH, full, BLANK_GRAPH)));
        expect(cut[4]).toBe(box(values("0.0%", BLANK_GRAPH, "0 MB", full, "0", BLANK_GRAPH)));
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
        expect(scaled[3]).toBe(box(labels(BLANK_GRAPH, full, `${space(GRAPH - 1)}⢸`)));
        expect(scaled[4]).toBe(
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
      expect(rows.slice(13, 16).map(ticketOf)).toEqual(["OLI-61", "OLI-70", "OLI-62"]);
      expect(rows[16]).toBe(blankBox);
      expect(rows[11]).toBe(queueTop("automation · running 1 · pending 2"));
      // A completed job placed on garage is not on its card either.
      expect(rows[6]).toBe(divider);
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
        expect(top[17]).toBe(bottom("1-4 of 6"));
        expect(top[18]).toBe(queueTop("automation · running 1 · pending 1"));
        const third = yield* draw(at(many, { servers: 3 }));
        expect(names(third)).toEqual(["  s0", "  s1", "  s2", "▸ s3"]);
        const fifth = yield* draw(at(many, { servers: 4 }));
        expect(names(fifth)).toEqual(["  s1", "  s2", "  s3", "▸ s4"]);
        expect(fifth[17]).toBe(bottom("2-5 of 6"));
        const last = yield* draw(at(many, { servers: 5 }));
        expect(names(last)).toEqual(["  s2", "  s3", "  s4", "▸ s5"]);
        expect(last[17]).toBe(bottom("3-6 of 6"));
        // Four or fewer: no window to speak of.
        const few = yield* draw(shown(SNAPSHOT));
        expect(few[10]).toBe(bottom());
      }),
  );

  it.effect(
    "shows only the cards that fit with their jobs, the queue keeping four rows, and cuts a card's jobs to the box",
    () =>
      Effect.gen(function* () {
        // Cards of seven rows: three fit in the twenty-six rows the box may take at 37 rows.
        const four = yield* draw(shown(busy(4)));
        expect(names(four)).toEqual(["▸ s0", "  s1", "  s2"]);
        expect(four[25]).toBe(bottom("1-3 of 6"));
        expect(four[26]).toBe(queueTop("automation · running 24 · pending 0"));
        expect(four[27]).toBe(box(JOB_HEADER));
        // Three cards of four jobs, then the seven queue rows.
        expect(four.filter((row) => /^│ [▸ ] OLI-/.test(row))).toHaveLength(12 + 7);
        expect(four[35]).toBe(bottom("1-7 of 24"));
        expect(four[36]).toBe(FOOTER);
        // Cards of eleven rows: two fit.
        const eight = yield* draw(shown(busy(8)));
        expect(names(eight)).toEqual(["▸ s0", "  s1"]);
        expect(eight[25]).toBe(bottom("1-2 of 6"));
        // The window ends at the selected card and grows upward first: the last card's last
        // job selected shows the three cards above it that fit.
        const end = yield* draw(at(busy(4), { servers: 29 }));
        expect(names(end)).toEqual(["  s3", "  s4", "  s5"]);
        expect(
          end
            .slice(0, 25)
            .filter((row) => row.startsWith("│ ▸ OLI-"))
            .map(ticketOf),
        ).toEqual(["OLI-53"]);
        expect(end[25]).toBe(bottom("4-6 of 6"));
        // A taller terminal fits all four.
        const tall = yield* draw(shown(busy(4)), READ_AT, COLUMNS, 50);
        expect(names(tall)).toEqual(["▸ s0", "  s1", "  s2", "  s3"]);
        expect(tall[33]).toBe(bottom("1-4 of 6"));
        // A server running more guests than the box has rows shows what fits and the queue keeps
        // its four rows; the frame is still the terminal's height.
        const crowded = yield* draw(shown(busy(30)));
        expect(crowded).toHaveLength(ROWS);
        for (const row of crowded) {
          expect(row).toHaveLength(COLUMNS);
        }
        expect(names(crowded)).toEqual(["▸ s0"]);
        expect(crowded.slice(5, 28).every((row) => row.startsWith("│   OLI-0"))).toBe(true);
        expect(crowded[28]).toBe(bottom("1-1 of 6"));
        expect(crowded[29]).toBe(queueTop("automation · running 180 · pending 0"));
        expect(crowded[35]).toBe(bottom("1-4 of 180"));
        expect(crowded[36]).toBe(FOOTER);
        // The twenty-sixth job of that server selected (the card's header is the first entry):
        // the card's window ends on it, so the job L opens is on screen and marked.
        const deep = yield* draw(at(busy(30), { servers: 26 }));
        expect(deep.slice(5, 28).map(ticketOf)).toEqual(
          Array.from({ length: 23 }, (_, index) => `OLI-0${String(index + 3)}`),
        );
        expect(
          deep
            .slice(5, 28)
            .filter((row) => row.startsWith("│ ▸ "))
            .map(ticketOf),
        ).toEqual(["OLI-025"]);
        expect(deep[2]?.startsWith("│   s0")).toBe(true);
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
        // 37 rows: ten are the cards' box, three the queue's frame, one the footer.
        const first = yield* draw(shown(snapshot));
        expect(listed(first)).toHaveLength(23);
        expect(listed(first)[0]).toBe("OLI-100");
        expect(marked(first)).toEqual(["OLI-100"]);
        expect(first[35]).toBe(bottom("1-23 of 40"));
        const within = yield* draw(at(snapshot, { queue: 10 }));
        expect(listed(within)[0]).toBe("OLI-100");
        expect(marked(within)).toEqual(["OLI-110"]);
        const scrolled = yield* draw(at(snapshot, { queue: 30 }));
        expect(listed(scrolled)[0]).toBe("OLI-108");
        expect(listed(scrolled).at(-1)).toBe("OLI-130");
        expect(marked(scrolled)).toEqual(["OLI-130"]);
        expect(scrolled[35]).toBe(bottom("9-31 of 40"));
        const end = yield* draw(at(snapshot, { queue: 39 }));
        expect(listed(end)).toHaveLength(23);
        expect(marked(end)).toEqual(["OLI-139"]);
        expect(end[35]).toBe(bottom("18-40 of 40"));
        // A cursor past the end marks the last job; a taller terminal lists more.
        const past = yield* draw(at(snapshot, { queue: 90 }), READ_AT, COLUMNS, 50);
        expect(past).toHaveLength(50);
        expect(listed(past)).toHaveLength(36);
        expect(marked(past)).toEqual(["OLI-139"]);
        expect(past[48]).toBe(bottom("5-40 of 40"));
        expect(past[49]).toBe(FOOTER);
        const exact = yield* draw(
          shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: jobs.slice(0, 23) } }),
        );
        expect(exact[35]).toBe(bottom());
      }),
  );

  it.effect("draws the selection j and k moved: a card's job marked, the header unmarked", () =>
    Effect.gen(function* () {
      const snapshot: View.Snapshot = {
        ...SNAPSHOT,
        queue: { ...QUEUE, running: [running, diagnosing] },
      };
      const onJob = yield* draw(at(snapshot, { servers: 1 }));
      expect(onJob[2]?.startsWith("│   garage")).toBe(true);
      expect(onJob[5]).toBe(box(job("▸", RUNNING)));
      expect(onJob[7]?.startsWith("│   — ·")).toBe(true);
      const next = yield* draw(at(snapshot, { servers: 2 }));
      expect(next[5]).toBe(box(job(" ", RUNNING)));
      expect(next[7]?.startsWith("│ ▸ — ·")).toBe(true);
      const clients = yield* draw(
        shown(snapshot, { tab: "clients", cursor: { servers: 0, clients: 2, queue: 0 } }),
      );
      expect(clients[2]?.startsWith("│   runner")).toBe(true);
      expect(clients[5]).toBe(box(job(" ", RUNNING)));
      expect(clients[6]).toBe(box(job("▸", DIAGNOSING)));
      // A job that finished under the cursor: the rows above take the selection.
      const gone = yield* draw(
        shown(SNAPSHOT, { tab: "clients", cursor: { servers: 0, clients: 2, queue: 0 } }),
      );
      expect(gone[5]).toBe(box(job("▸", RUNNING)));
      // The queue focused with its second job selected, the machines keeping their place.
      const three = {
        ...SNAPSHOT,
        queue: { ...QUEUE, pending: [{ ...pending, ticket: "OLI-70" }, pending] },
      };
      const queued = yield* draw(
        shown(three, { focus: "queue", cursor: { servers: 2, clients: 0, queue: 1 } }),
      );
      expect(queued[2]?.startsWith("│   garage")).toBe(true);
      expect(queued[7]?.startsWith("│ ▸ — ·")).toBe(true);
      expect(queued.slice(13, 16).map((row) => row.slice(2, 3))).toEqual([" ", "▸", " "]);
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
        expect(old[2]).toContain("silent · seen 1 h ago");
        expect(old[6]).toContain("silent · seen 1 d ago");
      }),
  );

  it.effect("adds the time since the read to every age, and says how old the read itself is", () =>
    Effect.gen(function* () {
      const rows = yield* draw(shown(SNAPSHOT), READ_AT + 3_000);
      expect(rows[0]).toBe(machinesTop("read 3 s ago"));
      expect(rows[2]).toContain("seen 15 s ago");
      expect(rows[5]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      expect(rows[13]).toContain(`${pad("3 min ago", 11)}  ${pad("48 s ago", 11)}`);
      const later = yield* draw(shown(SNAPSHOT), READ_AT + 125_000);
      expect(later[0]).toBe(machinesTop("read 2 min ago"));
    }),
  );

  it.effect("never reads a stamp the database wrote just ahead of its clock as negative", () =>
    Effect.gen(function* () {
      const ahead: Servers.Machine = { ...garage, heartbeatAt: ago(-2) };
      const rows = yield* draw(shown({ ...SNAPSHOT, machines: [ahead] }));
      expect(rows[2]).toContain("seen 0 s ago");
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
        expect(rows[2]).toBe(
          box(header("▸ attic · https://qemu-b.example.com", "silent · seen 5 min ago")),
        );
        expect(rows[3]).toBe(
          box(labels(BLANK_GRAPH, `${space(GRAPH - 1)}⢸`, `${space(GRAPH - 1)}⢸`)),
        );
        expect(rows[4]).toBe(
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
        expect(styleOf(spans[2], "silent · seen 5 min ago")).toEqual([LOVE, PLAIN]);
        const dots = [...(spans[3] ?? []), ...(spans[4] ?? [])].filter((span) => span[0] === "⢸");
        expect(dots).toHaveLength(5);
        expect(dots.every((span) => span[1] === MUTED)).toBe(true);
        expect(colorsOf(spans[3])).not.toContain(PINE);
        expect(colorsOf(spans[4])).not.toContain(IRIS);
        expect(styleOf(spans[4], "   50.0%")).toEqual([MUTED, PLAIN]);
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
        expect((yield* draw(shown(heard(90))))[2]).toContain("31.5 / 66.9 GB");
        expect((yield* draw(shown(heard(91))))[2]).toContain("silent · seen 1 min ago");
        expect((yield* draw(shown(heard(88)), READ_AT + 3_000))[2]).toContain(
          "silent · seen 1 min ago",
        );
      }),
  );

  it.effect("draws a live machine without readings with dashes and empty graphs", () =>
    Effect.gen(function* () {
      const rows = yield* draw(shown({ ...SNAPSHOT, machines: [garage], series: [] }));
      expect(rows[2]).toBe(box(header("▸ garage · http://127.0.0.1:55332", GARAGE_RIGHT)));
      expect(rows[3]).toBe(box(labels(BLANK_GRAPH, BLANK_GRAPH, BLANK_GRAPH)));
      expect(rows[4]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
      // A client's readings never dress a server of the same name.
      const crossed = yield* draw(
        shown({
          ...SNAPSHOT,
          machines: [garage],
          series: [{ ...garageSeries, type: "automation-client" }],
        }),
      );
      expect(crossed[4]).toBe(box(values("—", BLANK_GRAPH, "—", BLANK_GRAPH, "—", BLANK_GRAPH)));
    }),
  );

  it.effect("says so in a tab with no machines, and gives the queue the rows", () =>
    Effect.gen(function* () {
      const servers = yield* draw(shown({ ...SNAPSHOT, machines: [runner] }));
      expect(servers[0]).toBe(machinesTop("read 0 s ago"));
      expect(servers[1]).toBe(box("qemu servers · 0 │ automation clients · 1"));
      expect(servers[2]).toBe(box("no qemu servers registered"));
      expect(servers[3]).toBe(bottom());
      expect(servers[4]).toBe(queueTop("automation · running 1 · pending 1"));
      expect(servers[6]).toBe(box(job("▸", RUNNING)));
      const clients = yield* draw(shown({ ...SNAPSHOT, machines: [garage] }, { tab: "clients" }));
      expect(clients[2]).toBe(box("no automation clients registered"));
      const spans = yield* styled(shown({ ...SNAPSHOT, machines: [] }));
      expect(styleOf(spans[2], "no qemu servers registered")).toEqual([MUTED, PLAIN]);
    }),
  );

  it.effect(
    "says so under the queue's header with nothing to list, marks nothing, and counts zero",
    () =>
      Effect.gen(function* () {
        const view = shown({ ...SNAPSHOT, queue: EMPTY_QUEUE }, { focus: "queue" });
        const rows = yield* draw(view);
        expect(rows[10]).toBe(queueTop("automation · running 0 · pending 0"));
        expect(rows[11]).toBe(box(JOB_HEADER));
        expect(rows[12]).toBe(box("no jobs"));
        expect(rows[13]).toBe(blankBox);
        const spans = yield* styled(view);
        // The machines' own marker stays, muted; nothing in the focused queue is marked.
        expect(spans.flat().filter((span) => span[0] === "▸")).toEqual([["▸", MUTED, PLAIN]]);
        expect(styleOf(spans[12], "no jobs")).toEqual([MUTED, PLAIN]);
      }),
  );

  it.effect("shows a dash for a job whose result has no ticket yet", () =>
    Effect.gen(function* () {
      const rows = yield* draw(
        shown({ ...SNAPSHOT, queue: { ...EMPTY_QUEUE, pending: [{ ...pending, ticket: null }] } }),
      );
      expect(rows[12]?.startsWith(`│ ▸ ${cells(pad("—", 9), pad("install", 18))}`)).toBe(true);
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
      expect(rows[2]).toBe(box(header(`▸ ${long.slice(0, left - 3)}…`, GARAGE_RIGHT)));
      const truncated = [
        "OLI-61",
        `${"a".repeat(17)}…`,
        "drive",
        "● running",
        "3 min ago",
        "45 s ago",
      ] as const;
      expect(rows[5]).toBe(box(job(" ", truncated)));
      expect(rows[9]).toBe(box(job("▸", truncated)));
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
          "drive",
          "● running",
          "3 min ago",
          "45 s ago",
        ] as const;
        expect(rows[5]).toBe(box(job(" ", cleaned)));
        expect(rows[13]).toBe(box(job("▸", cleaned)));
        expect(rows[ROWS - 1]).toBe(pad(" error: Failed query: select 1 params: []", COLUMNS));
      }),
  );

  it.effect("draws the empty boxes and the tabs before the first read has landed", () =>
    Effect.gen(function* () {
      const rows = yield* draw(View.initialView);
      expect(rows[0]).toBe(machinesTop("reading…"));
      expect(rows[1]).toBe(box("qemu servers │ automation clients"));
      expect(rows[2]).toBe(bottom());
      expect(rows[3]).toBe(queueTop("automation"));
      expect(rows[4]).toBe(box(JOB_HEADER));
      for (const row of rows.slice(5, ROWS - 2)) {
        expect(row).toBe(blankBox);
      }
      expect(rows[ROWS - 2]).toBe(bottom());
      expect(rows[ROWS - 1]).toBe(FOOTER);
      const spans = yield* styled(View.initialView);
      expect(styleOf(spans[1], "qemu servers")).toEqual([TEXT, BOLD]);
    }),
  );

  it.effect("puts a failed read's reason on the footer and keeps the last snapshot on screen", () =>
    Effect.gen(function* () {
      const reason = "Failed query: select 1: connect ECONNREFUSED 127.0.0.1:5432";
      const view = { ...shown(SNAPSHOT), failure: Option.some(reason) };
      const rows = yield* draw(view, READ_AT + 7_000);
      expect(rows[0]).toBe(machinesTop("read 7 s ago"));
      expect(rows[2]).toContain("http://127.0.0.1:55332");
      expect(rows[ROWS - 1]).toBe(pad(` error: ${reason}`, COLUMNS));
      expect(rows.join("\n")).not.toContain("q quit");
      const spans = yield* styled(view, READ_AT + 7_000);
      expect(styleOf(spans[ROWS - 1], `error: ${reason}`)).toEqual([LOVE, PLAIN]);
      const bare = yield* draw({ ...View.initialView, failure: Option.some(reason) });
      expect(bare[0]).toBe(machinesTop("reading…"));
      expect(bare[1]).toBe(box("qemu servers │ automation clients"));
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
