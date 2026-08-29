import { Agent } from "@cursor/sdk";

// Auth comes from the CURSOR_API_KEY environment variable, the SDK's default.

export type StartOptions = {
  /** Model id for the session. The server picks one when omitted. */
  model?: string;
};

export type CursorAgent = {
  /** The session ID: the SDK's bc-… cloud agent id. */
  readonly session: string;
};

/** Starts a new Cursor cloud agent session. */
export async function start(options: StartOptions = {}): Promise<CursorAgent> {
  const handle = await Agent.create({
    model: options.model === undefined ? undefined : { id: options.model },
    cloud: {},
  });
  const session = handle.agentId;
  handle.close();
  return { session };
}

/** Sends text to the agent's session and resolves with the reply once the run finishes. */
export async function prompt(agent: CursorAgent, text: string): Promise<string> {
  const handle = await Agent.resume(agent.session);
  try {
    const run = await handle.send(text);
    const result = await run.wait();
    if (result.status !== "finished") {
      const detail = result.error === undefined ? "" : `: ${result.error.message}`;
      throw new Error(`cursor-agent: run ${result.status}${detail}`);
    }
    return result.result ?? "";
  } finally {
    handle.close();
  }
}

/** Stops the agent's session: cancels its active run, if any, and archives it. */
export async function stop(agent: CursorAgent): Promise<void> {
  const runs = await Agent.listRuns(agent.session, { runtime: "cloud", limit: 1 });
  const run = runs.items.at(0);
  if (run?.status === "running") {
    await run.cancel();
  }
  await Agent.archive(agent.session);
}

/** One-shot: starts a session, prompts it, stops it, and returns the reply. */
export async function oneShotPrompt(text: string): Promise<string> {
  const agent = await start();
  try {
    return await prompt(agent, text);
  } finally {
    await stop(agent);
  }
}
