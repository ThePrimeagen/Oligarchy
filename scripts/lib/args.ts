import { parseArgs } from "node:util";

export type Pick = "highest" | "pcenter";
export type Model = "clef" | "clef-flash";

// Only what was given: anything left out is oligarchy.json's.
export type Overrides = {
  grid?: number;
  rounds?: ReadonlyArray<Pick>;
  threshold?: number;
  power?: number;
  boxScale?: number;
};

export type Plan = {
  readonly images: ReadonlyArray<string>;
  readonly question: string;
  readonly task: string;
  readonly overrides: Overrides;
  readonly out: string | null;
  readonly envFile: string | null;
  readonly model: Model;
};

type Refused = { readonly ok: false; readonly message: string };

const CELL = "grid cell {cell} (column {column}, row {row})";

const inImageTwo = (question: string): string =>
  /\bimage 2\b/i.test(question)
    ? question
    : `In image 2, ${question.charAt(0).toLowerCase()}${question.slice(1)}`;

// The question every cell is asked. A target is put in the standard question. A question may name
// the cell itself with {cell}; a dictated one says "this cell", or the words cell, column and row,
// which become the cell's label, letter and number.
export const phrase = (given: {
  readonly target?: string | undefined;
  readonly question?: string | undefined;
  readonly task?: string | undefined;
}): { readonly ok: true; readonly question: string; readonly task: string } | Refused => {
  const { target, question, task } = given;
  if (target !== undefined && question !== undefined) {
    return { ok: false, message: "give --target or --question, not both" };
  }
  if (target !== undefined) {
    const thing = target.trim().replace(/[.?!]+$/, "");
    return {
      ok: true,
      question: `In image 2, does ${CELL} contain ${thing}?`,
      task: task ?? `Click ${thing}.`,
    };
  }
  if (question === undefined) {
    return { ok: false, message: "give --target or --question" };
  }
  if (question.includes("{cell}")) {
    return { ok: true, question, task: task ?? question };
  }
  if (/\b(this|the|that) cell\b/i.test(question)) {
    return {
      ok: true,
      question: inImageTwo(question.replace(/\b(this|the|that) cell\b/i, CELL)),
      task: task ?? question,
    };
  }
  if (/\bcell\b/i.test(question)) {
    const tokens = question
      .replace(/\bcell\b/gi, "{cell}")
      .replace(/\bcolumn\b/gi, "{column}")
      .replace(/\brow\b/gi, "{row}");
    return { ok: true, question: inImageTwo(tokens), task: task ?? question };
  }
  return {
    ok: false,
    message:
      'the question must name the cell: write {cell}, "this cell", or the word cell; or give --target instead',
  };
};

const number = (text: string | undefined): number | undefined =>
  text === undefined || text.trim() === "" ? undefined : Number(text);

export const parse = (
  argv: ReadonlyArray<string>,
):
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: true; readonly help: true }
  | Refused => {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        image: { type: "string", multiple: true },
        target: { type: "string" },
        question: { type: "string" },
        task: { type: "string" },
        grid: { type: "string" },
        rounds: { type: "string" },
        threshold: { type: "string" },
        power: { type: "string" },
        "box-scale": { type: "string" },
        out: { type: "string" },
        "env-file": { type: "string" },
        model: { type: "string" },
        help: { type: "boolean" },
      },
    });
  } catch (thrown) {
    return { ok: false, message: thrown instanceof Error ? thrown.message : String(thrown) };
  }
  const { values, tokens } = parsed;
  if (values.help === true) {
    return { ok: true, help: true };
  }
  const images = tokens.flatMap((token) => {
    if (token.kind === "positional") {
      return [token.value];
    }
    return token.kind === "option" && token.name === "image" && token.value !== undefined
      ? [token.value]
      : [];
  });
  if (images.length === 0) {
    return { ok: false, message: "give at least one image" };
  }
  const phrased = phrase({ target: values.target, question: values.question, task: values.task });
  if (!phrased.ok) {
    return phrased;
  }

  const overrides: Overrides = {};
  const grid = number(values.grid);
  if (grid !== undefined) {
    if (!Number.isInteger(grid) || grid < 2 || grid > 8) {
      return { ok: false, message: "--grid must be a whole number from 2 to 8" };
    }
    overrides.grid = grid;
  }
  if (values.rounds !== undefined) {
    const names = values.rounds
      .split(/[\s,]+/)
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== "");
    if (names.length === 0) {
      return { ok: false, message: "--rounds must name at least one round" };
    }
    const unknown = names.find((name) => name !== "highest" && name !== "pcenter");
    if (unknown !== undefined) {
      return { ok: false, message: `--rounds: "${unknown}" is neither highest nor pcenter` };
    }
    overrides.rounds = names.filter(
      (name): name is Pick => name === "highest" || name === "pcenter",
    );
  }
  const threshold = number(values.threshold);
  if (threshold !== undefined) {
    if (!(threshold >= 0 && threshold <= 1)) {
      return { ok: false, message: "--threshold must be a number from 0 to 1" };
    }
    overrides.threshold = threshold;
  }
  const power = number(values.power);
  if (power !== undefined) {
    if (!(power > 0)) {
      return { ok: false, message: "--power must be a number above 0" };
    }
    overrides.power = power;
  }
  const boxScale = number(values["box-scale"]);
  if (boxScale !== undefined) {
    if (!(boxScale >= 1)) {
      return { ok: false, message: "--box-scale must be a number of at least 1" };
    }
    if (grid !== undefined && boxScale >= grid) {
      return { ok: false, message: `--box-scale must be smaller than the grid (${grid})` };
    }
    overrides.boxScale = boxScale;
  }
  const model = values.model ?? "clef";
  if (model !== "clef" && model !== "clef-flash") {
    return { ok: false, message: "--model must be clef or clef-flash" };
  }
  return {
    ok: true,
    plan: {
      images,
      question: phrased.question,
      task: phrased.task,
      overrides,
      out: values.out ?? null,
      envFile: values["env-file"] ?? null,
      model,
    },
  };
};
