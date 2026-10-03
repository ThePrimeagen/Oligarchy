import { describe, expect, it } from "vitest";

import * as DiagnosePrompt from "../src/diagnose-prompt.ts";

const MODEL = "meta/muse-spark-1.3-contributor";
const FIRST = "335dca25-6bb4-41dc-89ae-cd04cee3029d";
const SECOND = "c35cac41-4ff2-400c-9a18-0231dcef08d0";

// Every file a command in the prompt's example writes: a redirect target or an --output.
const written = (prompt: string): ReadonlyArray<string> =>
  prompt
    .split("\n")
    .filter((line) => line.startsWith("$ "))
    .flatMap((line) =>
      [...line.matchAll(/(?:\s> |--output )(\S+)/g)].map((match) => match[1] ?? ""),
    );

describe("the diagnosing agent's prompt", () => {
  it("names every file its example writes for the job under review (happy)", () => {
    const files = written(DiagnosePrompt.render(FIRST, MODEL));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toContain(FIRST);
  });

  it("never has two reviews running at once write the same file (unhappy)", () => {
    const first = written(DiagnosePrompt.render(FIRST, MODEL));
    const second = written(DiagnosePrompt.render(SECOND, MODEL));

    expect(first.filter((file) => second.includes(file))).toEqual([]);
  });
});
