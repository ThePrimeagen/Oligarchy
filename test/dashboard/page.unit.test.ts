import { html } from "hono/html";
import { describe, expect, it } from "vitest";
import { OperatorPage } from "../../src/dashboard/page.tsx";

// Phones lay this document out near 980px and scale it, so a mobile-sized query has to
// include that width. Narrower, and it never matches there.
const MOBILE = "@media (max-width: 980px)";

const render = async (): Promise<string> =>
  String(await html`${OperatorPage({ title: "oligarchy servers", page: "servers" })}`);

const styleOf = (page: string): string => page.match(/<style>([^<]*)<\/style>/)?.[1] ?? "";

describe("operator tabs", () => {
  it("draws both tabs twice the body size on a mobile-sized width, and no larger", async () => {
    const style = styleOf(await render());
    const mobile = style.slice(style.indexOf(MOBILE));
    expect(style).toMatch(/body\s*\{[^}]*font:\s*16px/);
    expect(mobile.startsWith(MOBILE)).toBe(true);
    const fontSizes = [...mobile.matchAll(/font-size:\s*([^;}]+)/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(fontSizes).toEqual(["2em"]);
    expect(mobile).toMatch(/\.tabs a\s*\{[^}]*font-size:\s*2em/);
    expect(mobile).not.toMatch(/padding|min-height|min-width|transform|scale\(/);
  });

  it("leaves both tabs at the body size when the width is not mobile-sized", async () => {
    const style = styleOf(await render());
    const base = style.split("@media")[0] ?? "";
    const tabRules = [...base.matchAll(/\.tabs a(?:\[[^\]]+\])?\s*\{[^}]*\}/g)].map(
      (match) => match[0],
    );
    expect(tabRules.join("\n")).toMatch(/color:\s*#9a9691/);
    expect(tabRules.join("\n")).not.toMatch(/font-size/);
    expect(base).not.toContain(MOBILE);
    expect(style).toContain(MOBILE);
  });
});
