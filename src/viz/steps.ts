// Every newest test definition ends its ActionList with a crash-report line, and 461 of the 469
// also put "always take a screen shot of every step" after it. Eight end on the singular crash
// sentence alone. Those sentences hold for the whole run, so they are not steps. A period may
// be there or not. "the desktop must return exactly as left" is a real step where it appears.
const TRAILING = new Set([
  "any crashes or erroneous behavior must be reported",
  "any crashes or erroneous behavior must be reported.",
  "Any crash or erroneous behavior must be reported",
  "Any crash or erroneous behavior must be reported.",
  "always take a screen shot of every step",
  "always take a screen shot of every step.",
]);

// The driver's rule: the message is the line with the leading asterisk and the spaces beside
// it removed. Nothing else is folded.
const stepText = (line: string): string => line.trim().replace(/^\*+\s+/, "");

const bullets = (instruction: string): Array<string> => {
  const start = instruction.indexOf("<ActionList>");
  const end = instruction.indexOf("</ActionList>");
  if (start === -1 || end < start) {
    return [];
  }
  return instruction
    .slice(start + "<ActionList>".length, end)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("*"));
};

// The steps a driver walks, in order, without the trailing crash and screenshot lines.
export const stepsOf = (instruction: string): ReadonlyArray<string> => {
  const lines = bullets(instruction);
  let last = lines.at(-1);
  while (last !== undefined && TRAILING.has(stepText(last))) {
    lines.pop();
    last = lines.at(-1);
  }
  return lines.map(stepText);
};

// 1-based place of a message that is a step, or 0 when it is not. A copied asterisk still
// matches: the driver is told to drop only that mark.
export const indexOf = (steps: ReadonlyArray<string>, message: string): number => {
  const wanted = stepText(message);
  if (wanted.length === 0) {
    return 0;
  }
  const at = steps.indexOf(wanted);
  return at === -1 ? 0 : at + 1;
};
