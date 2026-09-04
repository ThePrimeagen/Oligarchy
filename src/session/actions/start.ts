import { freshAgentId, runClient, type Session } from "../client.ts";

export async function startRun(session: Session, rest: string): Promise<void> {
  if (session.sessionId !== undefined) {
    console.log(`session ${session.sessionId} is already running. stop it first.`);
    return;
  }
  const words = rest === "" ? [] : rest.split(/\s+/);
  if (words.length > 2) {
    console.log("usage: start [iso] [disk]");
    return;
  }
  const args = ["start"];
  if (words.length >= 1) {
    args.push("--iso", words[0]);
  }
  if (words.length === 2) {
    args.push("--disk", words[1]);
  }
  session.agentId = freshAgentId();
  console.log("booting; a first-time iso download can take a while...");
  session.startInFlight = runClient(session, args);
  const result = await session.startInFlight;
  session.startInFlight = undefined;
  if (result.code !== 0) {
    console.log(result.stderr);
    return;
  }
  session.sessionId = result.stdout.toString("utf8").trim();
  console.log(`agent   ${session.agentId}`);
  console.log(`session ${session.sessionId}`);
}
