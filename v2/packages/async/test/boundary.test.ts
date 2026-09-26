import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

const sources = (dir: string): Array<string> => {
  const found: Array<string> = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules") {
      continue;
    }
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "test") {
        continue;
      }
      found.push(...sources(path));
      continue;
    }
    if (name.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
};

const clock = join(root, "packages/async/src/clock.ts");

const forbidden =
  /\bsetTimeout\b|\bsetInterval\b|\bDate\.now\b|\bqueueMicrotask\b|\bfrom\s+["']effect["']|\bfrom\s+["']@effect\//;

describe("v2 boundaries", () => {
  it("keeps timers and Effect out of every source but the clock (happy)", () => {
    const hits = sources(root).flatMap((path) => {
      if (path === clock) {
        return [];
      }
      const lines = readFileSync(path, "utf8").split("\n");
      return lines.flatMap((line, index) =>
        forbidden.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
      );
    });
    expect(hits).toEqual([]);
  });

  it("still finds a timer written outside the clock (unhappy)", () => {
    const sample = `const wait = setTimeout(() => undefined, 1);`;
    expect(forbidden.test(sample)).toBe(true);
    expect(forbidden.test(`import { Effect } from "effect"`)).toBe(true);
    expect(forbidden.test(`import * as Node from "@effect/platform-node"`)).toBe(true);
    expect(forbidden.test(`const n = service.now();`)).toBe(false);
  });
});
