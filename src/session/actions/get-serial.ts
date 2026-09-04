import { requireSession, runClient, type Session } from "../client.ts";

export async function getSerialRun(session: Session, rest: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  if (rest !== "") {
    console.log("usage: get-serial");
    return;
  }
  const result = await runClient(session, ["get-serial", "--session-id", id]);
  if (result.code !== 0) {
    console.log(result.stderr);
    return;
  }
  const text = result.stdout.toString("utf8");
  console.log(text === "" ? "(serial is empty)" : text);
}
