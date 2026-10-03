import { describe, expect, test } from "vitest";
import { parse, phrase } from "./args.ts";

const STANDARD = "In image 2, does grid cell {cell} (column {column}, row {row}) contain";

describe("phrase", () => {
  test("a target becomes the standard per-cell question, and the task clicks it (happy)", () => {
    expect(phrase({ target: "the monitor icon in the menu bar" })).toEqual({
      ok: true,
      question: `${STANDARD} the monitor icon in the menu bar?`,
      task: "Click the monitor icon in the menu bar.",
    });
  });

  test("a question naming {cell} is sent as written; the task is the question (happy)", () => {
    const question = "In image 2, is Setup in grid cell {cell}?";
    expect(phrase({ question })).toEqual({ ok: true, question, task: question });
  });

  test("'this cell' becomes the grid cell, its column and its row, in image 2 (dictation)", () => {
    const question = "Does this cell contain the monitor icon for the monitor menu?";
    expect(phrase({ question })).toEqual({
      ok: true,
      question: `${STANDARD} the monitor icon for the monitor menu?`,
      task: question,
    });
  });

  test("the spoken words cell, column and row become their tokens (dictation)", () => {
    expect(phrase({ question: "Is the Setup entry in cell, column, row?" })).toMatchObject({
      ok: true,
      question: "In image 2, is the Setup entry in {cell}, {column}, {row}?",
    });
  });

  test("a task given is kept over the default", () => {
    expect(phrase({ target: "Setup", task: "Open the Setup menu." })).toMatchObject({
      task: "Open the Setup menu.",
    });
  });

  test("refuses a question that never names a cell (unhappy)", () => {
    expect(phrase({ question: "Where is the monitor icon?" })).toEqual({
      ok: false,
      message:
        'the question must name the cell: write {cell}, "this cell", or the word cell; or give --target instead',
    });
  });

  test("refuses both a target and a question, and neither (unhappy)", () => {
    expect(phrase({ target: "Setup", question: "Is Setup in this cell?" })).toMatchObject({
      ok: false,
      message: "give --target or --question, not both",
    });
    expect(phrase({})).toMatchObject({ ok: false, message: "give --target or --question" });
  });
});

describe("parse", () => {
  test("takes images from --image and the bare words, and every override (happy)", () => {
    const parsed = parse([
      "shot-3.png",
      "--image",
      "shot-6.png",
      "--target",
      "Setup",
      "--grid",
      "6",
      "--rounds",
      "highest,pcenter,pcenter",
      "--threshold",
      "0.3",
      "--power",
      "2",
      "--box-scale",
      "2",
      "--out",
      "/tmp/out",
      "--env-file",
      ".prod-env",
    ]);
    expect(parsed).toEqual({
      ok: true,
      plan: {
        images: ["shot-3.png", "shot-6.png"],
        question: `${STANDARD} Setup?`,
        task: "Click Setup.",
        overrides: {
          grid: 6,
          rounds: ["highest", "pcenter", "pcenter"],
          threshold: 0.3,
          power: 2,
          boxScale: 2,
        },
        out: "/tmp/out",
        envFile: ".prod-env",
      },
    });
  });

  test("leaves out every override not given, so oligarchy.json decides", () => {
    expect(parse(["a.png", "--target", "Setup"])).toMatchObject({
      ok: true,
      plan: { overrides: {}, out: null, envFile: null },
    });
  });

  test("answers help for --help", () => {
    expect(parse(["--help"])).toEqual({ ok: true, help: true });
  });

  test.each([
    { name: "no image", argv: ["--target", "Setup"], message: "give at least one image" },
    {
      name: "a round that is neither highest nor pcenter",
      argv: ["a.png", "--target", "x", "--rounds", "highest,middle"],
      message: '--rounds: "middle" is neither highest nor pcenter',
    },
    {
      name: "a grid that is not a whole number from 2 to 8",
      argv: ["a.png", "--target", "x", "--grid", "9"],
      message: "--grid must be a whole number from 2 to 8",
    },
    {
      name: "a box scale that would not shrink the box",
      argv: ["a.png", "--target", "x", "--grid", "3", "--box-scale", "3"],
      message: "--box-scale must be smaller than the grid (3)",
    },
    {
      name: "a threshold that is not a probability",
      argv: ["a.png", "--target", "x", "--threshold", "1.5"],
      message: "--threshold must be a number from 0 to 1",
    },
    {
      name: "an unknown flag",
      argv: ["a.png", "--target", "x", "--zoom", "3"],
      message: "Unknown option '--zoom'",
    },
  ])("refuses $name (unhappy)", ({ argv, message }) => {
    const parsed = parse(argv);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ message: expect.stringContaining(message) });
  });
});
