import type * as Locator from "@oligarchy/locator";
import type * as ScreenGrid from "@oligarchy/screen-grid";

export type Outcome =
  | {
      readonly kind: "found";
      readonly pixel: ScreenGrid.Point;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "notFound"; readonly best: number; readonly threshold: number }
  | { readonly kind: "failed"; readonly name: string; readonly message: string };

export type Step = {
  readonly pick: Locator.Pick;
  readonly box: ScreenGrid.Box;
  readonly best: number;
  readonly point: ScreenGrid.Point;
  readonly inputTokens: number;
  // Every cell's probability by label, in reading order.
  readonly cells: Readonly<Record<string, number>>;
};

// One search of one image by one model.
export type Attempt = {
  readonly run: number;
  readonly model: string;
  readonly image: string;
  readonly outcome: Outcome;
  readonly steps: ReadonlyArray<Step>;
  readonly timing: { readonly totalMs: number; readonly clefCallsMs: ReadonlyArray<number> };
};

export type Header = {
  readonly question: string;
  readonly task: string;
  readonly search: Locator.Options;
  readonly models: ReadonlyArray<string>;
  readonly runs: number;
  readonly images: ReadonlyArray<string>;
};

export const stepOf = (round: Locator.Round): Step => ({
  pick: round.pick,
  box: round.box,
  best: round.best,
  point: round.point,
  inputTokens: round.inputTokens,
  cells: Object.fromEntries(round.cells.map((cell) => [cell.label, Number(cell.p.toFixed(4))])),
});

const QUANTILES = [10, 25, 50, 75, 90, 99];

const quantile = (sorted: ReadonlyArray<number>, p: number): number => {
  const k = ((sorted.length - 1) * p) / 100;
  const low = sorted[Math.floor(k)] ?? 0;
  const high = sorted[Math.ceil(k)] ?? low;
  return low + (high - low) * (k - Math.floor(k));
};

const mean = (xs: ReadonlyArray<number>): number =>
  xs.reduce((sum, x) => sum + x, 0) / Math.max(1, xs.length);

const round = (n: number): string => String(Math.round(n));

export const outcomeText = (outcome: Outcome): string => {
  if (outcome.kind === "found") {
    return `found (${round(outcome.pixel.x)}, ${round(outcome.pixel.y)}) [${outcome.x.toFixed(3)}, ${outcome.y.toFixed(3)}]`;
  }
  if (outcome.kind === "notFound") {
    return `not found (best ${outcome.best.toFixed(2)} < ${outcome.threshold})`;
  }
  return `failed: ${outcome.name}: ${outcome.message}`;
};

const ranked = (step: Step): ReadonlyArray<readonly [string, number]> =>
  Object.entries(step.cells).toSorted(([, a], [, b]) => b - a);

const boxText = (box: ScreenGrid.Box): string =>
  `x ${round(box.left)}-${round(box.right)}, y ${round(box.top)}-${round(box.bottom)}`;

const pointText = (point: ScreenGrid.Point): string => `(${round(point.x)}, ${round(point.y)})`;

// Columns by letter and rows by number, from the labels themselves.
const gridOf = (step: Step) => {
  const labels = Object.keys(step.cells);
  const columns = [...new Set(labels.map((label) => label.slice(0, 1)))];
  const rows = [...new Set(labels.map((label) => label.slice(1)))];
  return { columns, rows };
};

// One step as the terminal shows it: rule, box, the best cells, the point, and the whole grid.
export const stepLines = (step: Step, index: number): ReadonlyArray<string> => {
  const [best, ...rest] = ranked(step);
  const { columns, rows } = gridOf(step);
  const cell = (label: string) => {
    const text = (step.cells[label] ?? 0).toFixed(3);
    return label === best?.[0] ? `[${text}]` : ` ${text} `;
  };
  return [
    `  round ${index + 1}  ${step.pick}  ${boxText(step.box)}`,
    `    best ${best?.[0]} ${best?.[1].toFixed(3)}   then ${rest
      .slice(0, 3)
      .map(([label, p]) => `${label} ${p.toFixed(3)}`)
      .join(", ")}   point ${pointText(step.point)}`,
    `       ${columns.map((column) => `   ${column}   `).join("")}`,
    ...rows.map(
      (row) =>
        `    ${row.padStart(2)} ${columns.map((column) => cell(`${column}${row}`)).join("")}`,
    ),
  ];
};

const table = (head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>) =>
  [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

const quantileRow = (label: ReadonlyArray<string>, xs: ReadonlyArray<number>) => {
  const sorted = xs.toSorted((a, b) => a - b);
  return [
    ...label,
    String(xs.length),
    ...QUANTILES.map((p) => round(quantile(sorted, p))),
    round(mean(xs)),
  ];
};

const QUANTILE_HEAD = ["n", ...QUANTILES.map((p) => `p${p}`), "mean"];

const stepMarkdown = (step: Step, index: number, dir: string): string => {
  const [best, ...rest] = ranked(step);
  const { columns, rows } = gridOf(step);
  return [
    `#### Round ${index + 1}: ${step.pick}`,
    "",
    `Box ${boxText(step.box)}. Best **${best?.[0]} ${best?.[1].toFixed(3)}**, then ${rest
      .slice(0, 3)
      .map(([label, p]) => `${label} ${p.toFixed(3)}`)
      .join(", ")}. Point ${pointText(step.point)}. ${step.inputTokens} input tokens.`,
    "",
    `![round ${index + 1}](${dir}/round-${index + 1}-out.png)`,
    "",
    table(
      ["", ...columns],
      rows.map((row) => [
        row,
        ...columns.map((column) => {
          const label = `${column}${row}`;
          const text = (step.cells[label] ?? 0).toFixed(3);
          return label === best?.[0] ? `**${text}**` : text;
        }),
      ]),
    ),
    "",
  ].join("\n");
};

// report.md: what was asked, every answer and how often it repeated, every step of run 1 with its
// pictures and probabilities, and the timing quantiles.
export const report = (header: Header, attempts: ReadonlyArray<Attempt>): string => {
  const pairs = header.images.flatMap((image) =>
    header.models.map((model) => ({
      image,
      model,
      all: attempts.filter((each) => each.image === image && each.model === model),
    })),
  );
  const { search } = header;
  const lines = [
    "# Tile search",
    "",
    `- question: ${header.question}`,
    `- task: ${header.task}`,
    `- search: ${search.grid}x${search.grid}, rounds ${search.rounds.join(" ")}, threshold ${search.threshold}, power ${search.power}, box scale ${search.boxScale}`,
    `- models: ${header.models.join(", ")}`,
    `- runs: ${header.runs}`,
    "",
    "## Answers",
    "",
    table(
      ["Image", "Model", "Answer (run 1)", "Same answer", "Rounds (run 1)", "Median search ms"],
      pairs.map(({ image, model, all }) => {
        const first = all[0];
        const answer = first === undefined ? "" : outcomeText(first.outcome);
        const same = all.filter((each) => outcomeText(each.outcome) === answer).length;
        const steps = (first?.steps ?? [])
          .map((step) => {
            const [best] = ranked(step);
            return `${step.pick} ${best?.[0]} ${best?.[1].toFixed(2)}`;
          })
          .join(" > ");
        const totals = all.map((each) => each.timing.totalMs).toSorted((a, b) => a - b);
        return [image, model, answer, `${same}/${all.length}`, steps, round(quantile(totals, 50))];
      }),
    ),
    "",
    "## Steps (run 1)",
    "",
  ];
  for (const { image, model, all } of pairs) {
    const first = all[0];
    if (first === undefined) {
      continue;
    }
    const dir = `${model}/${image}`;
    lines.push(`### ${image}, ${model}`, "", outcomeText(first.outcome), "");
    if (first.steps.length > 0) {
      lines.push(`![sheet](${dir}/sheet.png)`, "");
    }
    lines.push(...first.steps.map((step, index) => stepMarkdown(step, index, dir)));
    if (first.outcome.kind === "found") {
      lines.push(`![close-up of the click](${dir}/zoom.png)`, "");
    }
  }
  const retried = attempts.filter(
    (each) => each.outcome.kind !== "failed" && each.timing.clefCallsMs.length > each.steps.length,
  );
  lines.push(
    "## Timing (ms)",
    "",
    "### Whole search",
    "",
    table(
      ["Image", "Model", ...QUANTILE_HEAD],
      pairs.map(({ image, model, all }) =>
        quantileRow(
          [image, model],
          all.map((each) => each.timing.totalMs),
        ),
      ),
    ),
    "",
    "### One Clef call",
    "",
    table(
      ["Model", ...QUANTILE_HEAD],
      header.models.map((model) =>
        quantileRow(
          [model],
          attempts
            .filter((each) => each.model === model)
            .flatMap((each) => each.timing.clefCallsMs),
        ),
      ),
    ),
    "",
    "### Asked again (busy, down or slow Clef)",
    "",
    retried.length === 0
      ? "None."
      : retried
          .map(
            (each) =>
              `- ${each.image}, ${each.model}, run ${each.run}: calls ${each.timing.clefCallsMs.join(" + ")} ms, ${each.timing.totalMs} ms in all`,
          )
          .join("\n"),
    "",
  );
  return lines.join("\n");
};
