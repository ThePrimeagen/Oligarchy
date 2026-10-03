const CELL = "grid cell {cell} (column {column}, row {row})";

const inImageTwo = (question: string): string =>
  /\bimage 2\b/i.test(question)
    ? question
    : `In image 2, ${question.charAt(0).toLowerCase()}${question.slice(1)}`;

// The question every cell is asked, and the task Clef is told. A target goes into the standard
// question. A question may name the cell with {cell}; a dictated one says "this cell", or the words
// cell, column and row, which become the cell's label, letter and number.
export const phrase = (given: {
  readonly target?: string | undefined;
  readonly question?: string | undefined;
  readonly task?: string | undefined;
}):
  | { readonly ok: true; readonly question: string; readonly task: string }
  | { readonly ok: false; readonly message: string } => {
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
