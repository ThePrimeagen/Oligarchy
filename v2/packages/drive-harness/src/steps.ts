// Definitions end their ActionList with a crash-report line, most with a screenshot line after
// it. Those hold for the whole run, so they are not steps. A period may be there or not.
const TRAILING = new Set([
  "any crashes or erroneous behavior must be reported",
  "any crashes or erroneous behavior must be reported.",
  "Any crash or erroneous behavior must be reported",
  "Any crash or erroneous behavior must be reported.",
  "always take a screen shot of every step",
  "always take a screen shot of every step.",
]);

// A step is its line with the leading asterisk and the spaces beside it removed.
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
