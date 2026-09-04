import { requireSession, runClient, type Session } from "../client.ts";

export async function sendKeysRun(session: Session, rest: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  if (rest === "") {
    console.log("usage: send-keys <keys>");
    return;
  }
  const result = await runClient(session, ["send-keys", "--session-id", id, "--keys", rest]);
  console.log(result.code === 0 ? "ok" : result.stderr);
}
