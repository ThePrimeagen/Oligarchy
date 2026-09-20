import type { FC, PropsWithChildren } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";

// The operator document, shared by the homepage and the definitions page: dark text, and two
// tabs up top. The style is the servers page's; a definition's fields use the same controls.
const PAGE_STYLE =
  ':root { color-scheme: dark; } body { margin: 24px 32px 40px; font: 16px/1.4 system-ui, sans-serif; color: #e8e6e3; background: #161616; } h1, h2, h3 { color: #fff; } h1 { margin: 0 0 20px; } h2 { margin: 1.25rem 0 12px; } p.wording { white-space: pre-wrap; } table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 4px 10px 4px 0; vertical-align: top; } th { color: #9a9691; font-weight: 600; } input, textarea, button { color: #e8e6e3; background: #1f1f1f; border: 1px solid #2c2c2c; border-radius: 6px; padding: 4px 8px; } button { cursor: pointer; } button:disabled { color: #6b6762; cursor: default; opacity: 0.45; } textarea { display: block; width: 40rem; max-width: 100%; font: inherit; } label { display: block; margin: 12px 0; } .tabs { display: flex; gap: 1rem; margin: 0 0 20px; } .tabs a { color: #9a9691; text-decoration: none; } .tabs a[aria-current=page] { color: #fff; border-bottom: 2px solid #fff; } .halves { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; } .abort { background: none; border: none; padding: 0; cursor: pointer; line-height: 0; vertical-align: middle; } .process-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .process-card { display: grid; gap: 10px; background: #1f1f1f; border: 1px solid #2c2c2c; border-radius: 12px; padding: 14px 16px 12px; } .process-card > header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; } .process-card > header h3, .process-card > header p, .process-card > p { margin: 0; } .process-card > header p { color: #9a9691; font-size: 13px; } .process-graph { display: grid; gap: 10px; } .process-graph__plot { position: relative; height: 10rem; background: #111; border-radius: 8px; overflow: hidden; } .process-graph__plot::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(to top, #2a2a2a 1px, transparent 1px); background-size: 100% 25%; opacity: 0.7; } .process-graph__bars { position: absolute; inset: 10px 10px 8px; display: flex; align-items: flex-end; gap: 2px; } .process-graph__bar { flex: 1 1 0; min-width: 0; min-height: 0; background: #3f3f46; border-radius: 3px 3px 0 0; } .process-graph__lines { position: absolute; inset: 10px 10px 8px; width: calc(100% - 20px); height: calc(100% - 18px); overflow: visible; } .process-graph__lines .process-graph__jobs, .process-graph__lines .process-graph__cpu { fill: none; stroke-width: 2.25; } .process-graph__lines .process-graph__jobs { stroke: #fbbf24; } .process-graph__lines .process-graph__cpu { stroke: #38bdf8; } .process-graph__legend { display: flex; gap: 16px; list-style: none; margin: 0; padding: 0; font-size: 13px; color: #c4c0ba; } .process-graph__legend li::before { content: ""; display: inline-block; width: 12px; height: 8px; margin-right: 6px; vertical-align: middle; border-radius: 1px; } .process-graph__legend .process-graph__memory::before { background: #3f3f46; } .process-graph__legend .process-graph__jobs::before { background: #fbbf24; height: 3px; } .process-graph__legend .process-graph__cpu::before { background: #38bdf8; height: 3px; } .running-tests { margin: 0 0 20px; } .running-tests__list { list-style: none; margin: 0; padding: 0; } .running-tests__job { display: flex; flex-wrap: wrap; gap: 0.6rem 1rem; align-items: baseline; } .running-tests a { color: #fff; }';

export type OperatorTab = "servers" | "definitions";

const TABS = [
  { id: "servers", href: "/", label: "servers" },
  { id: "definitions", href: "/definitions", label: "definitions" },
] as const;

const Tabs: FC<{ page: OperatorTab }> = ({ page }) => (
  <nav class="tabs" aria-label="Pages">
    {TABS.map((tab) => (
      <a href={tab.href} aria-current={tab.id === page ? "page" : undefined}>
        {tab.label}
      </a>
    ))}
  </nav>
);

// `scriptSrc` is the one extra script a page needs. The servers page polls with htmx alone;
// the definitions page's update button is enabled by /dashboard.js.
export const OperatorPage: FC<
  PropsWithChildren<{ title: string; page: OperatorTab; scriptSrc?: string }>
> = ({ title, page, scriptSrc, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>{title}</title>
      <style>{PAGE_STYLE}</style>
      <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
      {scriptSrc === undefined ? null : <script src={scriptSrc} defer></script>}
    </head>
    <body>
      <Tabs page={page} />
      {children}
    </body>
  </html>
);
