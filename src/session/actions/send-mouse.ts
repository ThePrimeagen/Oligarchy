import { requireSession, runClient, type Session } from "../client.ts";

export async function sendMouseRun(session: Session, rest: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  const [x, y, button, clicks, ...extra] = rest === "" ? [] : rest.split(/\s+/);
  if (x === undefined || y === undefined || extra.length > 0) {
    console.log("usage: send-mouse <x> <y> [button] [clicks]");
    return;
  }
  const args = ["send-mouse", "--session-id", id, "--x", x, "--y", y];
  if (button !== undefined) {
    args.push("--button", button);
  }
  if (clicks !== undefined) {
    args.push("--clicks", clicks);
  }
  const result = await runClient(session, args);
  console.log(result.code === 0 ? "ok" : result.stderr);
}
