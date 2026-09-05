import type { Session } from "../client.ts";

export function statusRun(session: Session): void {
  console.log(`agent   ${session.agentId}`);
  console.log(`server  ${session.serverUrl}`);
  console.log(`session ${session.sessionId ?? "none"}`);
  console.log(`intent  ${session.intentOpen ? "open" : "none"}`);
}
