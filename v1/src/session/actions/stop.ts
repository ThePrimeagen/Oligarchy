import { requireSession, runClient, type Session } from "../client.ts";

export const STOP_STATUSES = ["succeeded", "failed", "aborted"];

export async function stopRun(session: Session, rest: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  const status = rest === "" ? undefined : rest.split(/\s+/, 1)[0];
  if (status !== undefined && !STOP_STATUSES.includes(status)) {
    console.log("usage: stop [succeeded|failed|aborted] [reason]");
    return;
  }
  const args = ["stop", "--session-id", id];
  if (status !== undefined) {
    args.push("--status", status);
    const reason = rest.slice(status.length).trim();
    if (reason !== "") {
      args.push("--reason", reason);
    }
  }
  const result = await runClient(session, args);
  // Clear the session either way: a failed stop means the proxy already lost it
  // (killed on timeout, gone), so keeping the id would only wedge the next start.
  session.sessionId = undefined;
  session.intentOpen = false;
  console.log(result.code === 0 ? `stopped ${id}` : result.stderr);
}
