import type { FC } from "hono/jsx";
import { definitionHref } from "./definitions.tsx";
import { OperatorPage } from "./page.tsx";
import type { TestDump } from "./query.ts";

const when = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

// Not a designed page. The wording that ran is at the top, as a link back to that definition and
// as the name, and then the result's screenshots and logs are dumped. The layout comes later.
export const TestPage: FC<{ dump: TestDump }> = ({ dump }) => (
  <OperatorPage title="oligarchy test" page="definitions">
    <h1>{dump.name}</h1>
    <p>
      <a href={definitionHref(dump.name)}>{dump.name}</a>
      {` v${dump.version}`}
    </p>
    <h2>definition</h2>
    <p class="wording">{dump.description}</p>
    <p class="wording">{dump.instruction}</p>
    <p class="wording">{dump.proof}</p>
    <h2>result</h2>
    <p>{dump.status}</p>
    <p>
      <time datetime={dump.at.toISOString()}>{when.format(dump.at)}</time>
    </p>
    {dump.model === null ? null : <p>{dump.model}</p>}
    {dump.ticket === null ? null : <p>{dump.ticket}</p>}
    {dump.sessionId === null ? <p>no session</p> : <p>{dump.sessionId}</p>}
    {dump.status === "failed" && dump.reason !== null ? (
      <p class="test-reason">{dump.reason}</p>
    ) : null}
    <h2>screenshots</h2>
    {dump.screenshots.length === 0 ? (
      <p>no screenshots</p>
    ) : (
      dump.screenshots.map((id) => <img src={`/images/${id}`} alt="" />)
    )}
    <h2>logs</h2>
    {dump.logs.length === 0 ? (
      <p>no logs</p>
    ) : (
      <pre class="test-logs">
        {dump.logs.map((line) => `${line.level} ${line.text}`).join("\n")}
      </pre>
    )}
  </OperatorPage>
);

export const TestMissingPage: FC = () => (
  <OperatorPage title="oligarchy test" page="definitions">
    <h1>test</h1>
    <p>No test result.</p>
  </OperatorPage>
);

export const TestUnavailablePage: FC = () => (
  <OperatorPage title="oligarchy test" page="definitions">
    <h1>test</h1>
    <p>error: The test result is unavailable.</p>
  </OperatorPage>
);
