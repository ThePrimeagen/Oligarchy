import { Agent } from "@cursor/sdk";

// Auth comes from the CURSOR_API_KEY environment variable, the SDK's default.

export type StartOptions = {
  /** Model id for the session. The server picks one when omitted. */
  model?: string;
};

export type PromptOptions = {
  /** Model id for this prompt. Sticky: later prompts without one keep it. */
  model?: string;
  /**
   * Rejoin this session. When omitted, prompt is one-shot: it starts a
   * session, prompts it, and stops it afterward.
   */
  session?: string;
};

/** Starts a new Cursor cloud agent session and returns its session ID. */
export async function start(options: StartOptions = {}): Promise<string> {
  const agent = await Agent.create({
    model: options.model === undefined ? undefined : { id: options.model },
    cloud: {},
  });
  const session = agent.agentId;
  agent.close();
  return session;
}

/** Sends text and resolves with the reply once the run finishes. */
export async function prompt(text: string, options: PromptOptions = {}): Promise<string> {
  if (options.session === undefined) {
    const session = await start({ model: options.model });
    try {
      return await prompt(text, { session });
    } finally {
      await stop(session);
    }
  }

  const agent = await Agent.resume(options.session);
  try {
    const run = await agent.send(
      text,
      options.model === undefined ? undefined : { model: { id: options.model } },
    );
    const result = await run.wait();
    if (result.status !== "finished") {
      const detail = result.error === undefined ? "" : `: ${result.error.message}`;
      throw new Error(`cursor-agent: run ${result.status}${detail}`);
    }
    return result.result ?? "";
  } finally {
    agent.close();
  }
}

/** Stops a session: cancels its active run, if any, and archives it. */
export async function stop(session: string): Promise<void> {
  const runs = await Agent.listRuns(session, { runtime: "cloud", limit: 1 });
  const run = runs.items.at(0);
  if (run?.status === "running") {
    await run.cancel();
  }
  await Agent.archive(session);
}
