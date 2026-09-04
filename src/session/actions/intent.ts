import { requireSession, runClient, type Session } from "../client.ts";

// A manual session has no Linear ticket, so its intents carry this result id.
const MANUAL_RESULT_ID = "manual";

export function intentRun(session: Session, rest: string): Promise<void> {
  const verb = rest.split(/\s+/, 1)[0];
  const message = rest.slice(verb.length).trim();
  switch (verb) {
    case "start":
      return intentStartRun(session, message);
    case "end":
      return intentEndRun(session, message);
    default:
      console.log("usage: intent start <message> | intent end");
      return Promise.resolve();
  }
}

export async function intentStartRun(session: Session, message: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  if (message === "") {
    console.log("usage: intent start <message>");
    return;
  }
  const result = await runClient(session, [
    "intent",
    "start",
    "--session-id",
    id,
    "--test-result-id",
    MANUAL_RESULT_ID,
    "--message",
    message,
  ]);
  if (result.code !== 0) {
    console.log(result.stderr);
    return;
  }
  session.intentOpen = true;
  console.log("ok");
}

export async function intentEndRun(session: Session, rest: string): Promise<void> {
  const id = requireSession(session);
  if (id === undefined) {
    return;
  }
  if (rest !== "") {
    console.log("usage: intent end");
    return;
  }
  const result = await runClient(session, ["intent", "end", "--session-id", id]);
  if (result.code !== 0) {
    console.log(result.stderr);
    return;
  }
  session.intentOpen = false;
  console.log("ok");
}
