import type { FC, PropsWithChildren } from "hono/jsx";
import { HTMX_INTEGRITY, HTMX_URL } from "./htmx.ts";

// The operator document, shared by the homepage and the definitions page. No stylesheet: the
// markup is the page, so a later edit does not have to unwind a layout. A definition's fields
// use the same plain controls as the servers page.
export type OperatorTab = "servers" | "definitions";

const TABS = [
  { id: "servers", href: "/", label: "servers" },
  { id: "definitions", href: "/definitions", label: "definitions" },
] as const;

const Tabs: FC<{ page: OperatorTab }> = ({ page }) => (
  <nav aria-label="Pages">
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
      <script src={HTMX_URL} integrity={HTMX_INTEGRITY} crossorigin="anonymous"></script>
      {scriptSrc === undefined ? null : <script src={scriptSrc} defer></script>}
    </head>
    <body>
      <Tabs page={page} />
      {children}
    </body>
  </html>
);
