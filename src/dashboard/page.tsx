import type { FC, PropsWithChildren } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";

// The operator document, shared by the homepage and the definitions page. The style is the
// servers page's, graphs included. A definition is the same text, tables and controls, not a
// layout of its own. A phone lays this page out near 980px and scales it, so the mobile query
// includes that width; below it the two tabs are 2em, twice the 16px body, and not more.
const PAGE_STYLE =
  ':root { color-scheme: dark; } body { margin: 24px 32px 40px; font: 16px/1.4 system-ui, sans-serif; color: #e8e6e3; background: #161616; } h1, h2, h3 { color: #fff; } h1 { margin: 0 0 20px; } h2 { margin: 1.25rem 0 12px; } p.wording { white-space: pre-wrap; } table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 4px 10px 4px 0; vertical-align: top; } th { color: #9a9691; font-weight: 600; } input, textarea, button { color: #e8e6e3; background: #1f1f1f; border: 1px solid #2c2c2c; border-radius: 6px; padding: 4px 8px; } button { cursor: pointer; } button:disabled { color: #6b6762; cursor: default; opacity: 0.45; } textarea { display: block; width: 40rem; max-width: 100%; font: inherit; } label { display: block; margin: 12px 0; } .tabs { display: flex; gap: 1rem; margin: 0 0 20px; } .tabs a { color: #9a9691; text-decoration: none; } .tabs a[aria-current=page] { color: #fff; border-bottom: 2px solid #fff; } .halves { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; } .abort { background: none; border: none; padding: 0; cursor: pointer; line-height: 0; vertical-align: middle; } .process-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } .process-card { display: grid; gap: 10px; background: #1f1f1f; border: 1px solid #2c2c2c; border-radius: 12px; padding: 14px 16px 12px; } .process-card > header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; } .process-card > header h3, .process-card > header p, .process-card > p { margin: 0; } .process-card > header p { color: #9a9691; font-size: 13px; } .process-graph { display: grid; gap: 10px; } .process-graph__plot { position: relative; height: 10rem; background: #111; border-radius: 8px; overflow: hidden; } .process-graph__plot::before { content: ""; position: absolute; inset: 0; background-image: linear-gradient(to top, #2a2a2a 1px, transparent 1px); background-size: 100% 25%; opacity: 0.7; } .process-graph__bars { position: absolute; inset: 10px 10px 8px; display: flex; align-items: flex-end; gap: 2px; } .process-graph__bar { flex: 1 1 0; min-width: 0; min-height: 0; background: #3f3f46; border-radius: 3px 3px 0 0; } .process-graph__lines { position: absolute; inset: 10px 10px 8px; width: calc(100% - 20px); height: calc(100% - 18px); overflow: visible; } .process-graph__lines .process-graph__jobs, .process-graph__lines .process-graph__cpu { fill: none; stroke-width: 2.25; } .process-graph__lines .process-graph__jobs { stroke: #fbbf24; } .process-graph__lines .process-graph__cpu { stroke: #38bdf8; } .process-graph__legend { display: flex; gap: 16px; list-style: none; margin: 0; padding: 0; font-size: 13px; color: #c4c0ba; } .process-graph__legend li::before { content: ""; display: inline-block; width: 12px; height: 8px; margin-right: 6px; vertical-align: middle; border-radius: 1px; } .process-graph__legend .process-graph__memory::before { background: #3f3f46; } .process-graph__legend .process-graph__jobs::before { background: #fbbf24; height: 3px; } .process-graph__legend .process-graph__cpu::before { background: #38bdf8; height: 3px; } .running-tests { margin: 0 0 20px; } .running-tests a { color: #fff; } .search { display: flex; gap: 8px; align-items: center; margin: 0 0 20px; } .search input[type=search] { width: 24rem; max-width: 100%; } .definition-list { list-style: none; margin: 0; padding: 0; } .definition-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; } /* The row is flex, which beats the hidden attribute, so a miss stayed listed. */ .definition-list li[hidden] { display: none; } .definition-list a { color: #fff; } a.ticket { color: #7dcfff; } td.follow { padding: 0; } td.follow a { display: block; padding: 4px 10px 4px 0; color: inherit; text-decoration: none; } .definition-rate { color: #9a9691; font-variant-numeric: tabular-nums; white-space: nowrap; } .definition-history { position: relative; display: inline-flex; align-items: center; gap: 8px; } .definition-blips { display: inline-flex; align-items: center; gap: 1px; height: 1lh; } a.definition-blip { position: relative; display: inline-block; width: 6px; height: 1lh; border-radius: 99px; text-decoration: none; } .definition-blip--passed { background: #9ece6a; } .definition-blip--failed { background: #f7768e; } .definition-blip--running { background: #fbbf24; } .definition-tip { display: none; position: absolute; z-index: 3; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); width: max-content; max-width: 24rem; padding: 8px 10px; background: #1f1f1f; border: 1px solid #2c2c2c; border-radius: 6px; color: #e8e6e3; font: 13px/1.4 system-ui, sans-serif; white-space: normal; text-align: left; } .definition-blip:hover .definition-tip, .definition-blip:focus-visible .definition-tip { display: block; } .definition-tip__name, .definition-tip__status, .definition-tip__model, .definition-tip__reason { display: block; } .definition-tip__reason { color: #f7768e; } .definition-history__wait { display: none; } .definition-history--loading .definition-history__wait { display: flex; position: absolute; inset: 0; z-index: 2; align-items: center; justify-content: center; gap: 6px; background: #161616; color: #e8e6e3; font-size: 12px; } .definition-runs { list-style: none; display: flex; flex-direction: column; gap: 6px; margin: 8px 0 16px; padding: 0; } .definition-runs li { display: flex; align-items: baseline; gap: 8px; } .definition-pill { display: inline-block; padding: 0 8px; border-radius: 99px; color: #161616; text-decoration: none; font-variant-numeric: tabular-nums; } .definition-pill--passed { background: #9ece6a; } .definition-pill--failed { background: #f7768e; } .suite__id { color: #9a9691; font-variant-numeric: tabular-nums; } .suite__passed { color: #9ece6a; } .suite__failed { color: #f7768e; } .definition-pill__time { color: #9a9691; font-variant-numeric: tabular-nums; white-space: nowrap; } .definition-pill__error, .definition-pill__diagnosis { color: #f7768e; } .definition-history__spin { width: 0.8em; height: 0.8em; box-sizing: border-box; border: 2px solid #6b6762; border-top-color: #fff; border-radius: 50%; animation: definition-history-spin 0.7s linear infinite; } .test-reason { color: #f7768e; } .test-logs { margin: 0; white-space: pre-wrap; font: 13px/1.4 ui-monospace, monospace; } img { display: block; max-width: 100%; margin: 8px 0; } @keyframes definition-history-spin { to { transform: rotate(360deg); } } @media (max-width: 980px) { .tabs a { font-size: 2em; } }';

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
// the definitions page's search and update button are /dashboard.js.
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
