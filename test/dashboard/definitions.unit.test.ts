import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import { DefinitionCard } from "../../src/dashboard/dashboard.tsx";
import type { TestDefinition, TestResultOutcome } from "../../src/dashboard/query.ts";

const at = (iso: string): Date => new Date(iso);

const wording = (id: number, instruction: string, createdAt: Date): TestDefinition => ({
  id,
  name: "lock-screen",
  description: "d",
  instruction,
  proof: "p",
  createdAt,
});

const outcome = (
  definitionId: number,
  status: TestResultOutcome["status"],
  model: string,
  createdAt: Date,
  finishedAt: Date | null,
): TestResultOutcome => ({
  definitionId,
  model,
  status,
  runId: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  startedAt: createdAt,
  createdAt,
  finishedAt,
  sessionStartedAt: null,
  sessionEndedAt: null,
});

const v1 = wording(2, "first", at("2026-09-01T00:00:00Z"));
const v2 = wording(5, "second", at("2026-09-02T00:00:00Z"));
const v3 = wording(9, "third", at("2026-09-03T00:00:00Z"));

const render = async (element: ReturnType<typeof DefinitionCard>): Promise<string> =>
  String(await html`${element}`);

describe("DefinitionCard happy path", () => {
  it("shows only the current wording and the one before it, newest open", async () => {
    const page = await render(
      DefinitionCard({
        group: { name: "lock-screen", versions: [v1, v2, v3] },
        outcomes: [
          outcome(2, "passed", "grok-4.6", at("2026-09-01T01:00:00Z"), at("2026-09-01T01:03:00Z")),
          outcome(5, "failed", "grok-4.6", at("2026-09-02T01:00:00Z"), at("2026-09-02T01:04:00Z")),
          outcome(
            9,
            "passed",
            "composer-2.5",
            at("2026-09-03T01:00:00Z"),
            at("2026-09-03T01:01:00Z"),
          ),
        ],
        notice: undefined,
      }),
    );
    expect(page).toContain("<h2>lock-screen</h2>");
    expect(page).toContain('aria-label="v2: 0 succeeded, 1 failed"');
    expect(page).toContain('aria-label="v3: 1 succeeded, 0 failed"');
    expect(page).not.toContain('aria-label="v1:');
    expect(page).toContain("<p>third</p>");
    expect(page).toContain("<p>second</p>");
    expect(page).not.toContain("<p>first</p>");
    expect(page).toContain('<details class="definition__wording" open="">');
    expect(page).toContain('<span class="definition__wording-label">v3</span>');
    expect(page).toContain('<span class="definition__wording-label">v2</span>');
    expect(page).not.toContain('<span class="definition__wording-label">v1</span>');
  });

  it("charts the last timed runs by duration, shortest first, with percentiles and no run table", async () => {
    const page = await render(
      DefinitionCard({
        group: { name: "lock-screen", versions: [v3] },
        outcomes: [
          outcome(9, "failed", "grok-4.6", at("2026-09-01T00:00:00Z"), at("2026-09-01T00:04:00Z")),
          outcome(9, "passed", "grok-4.6", at("2026-09-01T00:10:00Z"), at("2026-09-01T00:11:00Z")),
          outcome(
            9,
            "passed",
            "composer-2.5",
            at("2026-09-01T00:20:00Z"),
            at("2026-09-01T00:22:00Z"),
          ),
        ],
        notice: undefined,
      }),
    );
    expect(page).toContain("Last 50 runs by duration");
    expect(page).toContain('aria-label="succeeded in 1 min"');
    expect(page).toContain('aria-label="succeeded in 2 min"');
    expect(page).toContain('aria-label="failed in 4 min"');
    expect(page.indexOf('aria-label="succeeded in 1 min"')).toBeLessThan(
      page.indexOf('aria-label="succeeded in 2 min"'),
    );
    expect(page.indexOf('aria-label="succeeded in 2 min"')).toBeLessThan(
      page.indexOf('aria-label="failed in 4 min"'),
    );
    expect(page).toContain("<dt>10%</dt>");
    expect(page).toContain("<dt>25%</dt>");
    expect(page).toContain("<dt>median</dt>");
    expect(page).toContain("<dt>75%</dt>");
    expect(page).toContain("<dt>90%</dt>");
    expect(page).toContain("<dt>99%</dt>");
    expect(page).not.toContain('<table class="runs"');
    expect(page).not.toContain("No runs yet.");
  });
});

describe("DefinitionCard unhappy path", () => {
  it("says so when a wording has no passed or failed result and no timed run", async () => {
    const page = await render(
      DefinitionCard({
        group: { name: "lock-screen", versions: [v3] },
        outcomes: [outcome(9, "pending", "grok-4.6", at("2026-09-01T00:00:00Z"), null)],
        notice: undefined,
      }),
    );
    expect(page).toContain("No passed or failed results yet.");
    expect(page).toContain("No timed passed or failed results yet.");
    expect(page).not.toContain('class="result-chart__bar"');
    expect(page).not.toContain('class="duration-chart__bar');
    expect(page).not.toContain('<table class="runs"');
  });
});
