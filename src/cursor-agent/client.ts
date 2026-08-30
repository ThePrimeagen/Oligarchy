import { Agent } from "@cursor/sdk";

export type StartOptions = {
  model?: string;
};

export type CursorAgent = {
  readonly session: string;
};

export async function start(options: StartOptions = {}): Promise<CursorAgent> {
  const handle = await Agent.create({
    model: options.model === undefined ? undefined : { id: options.model },
    cloud: {},
  });
  const session = handle.agentId;
  handle.close();
  return { session };
}

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

export async function stop(agent: CursorAgent): Promise<void> {
  const runs = await Agent.listRuns(agent.session, { runtime: "cloud", limit: 1 });
  const run = runs.items.at(0);
  if (run?.status === "running") {
    await run.cancel();
  }
  await Agent.archive(agent.session);
}

export async function oneShotPrompt(text: string): Promise<string> {
  const agent = await start();
  let reply: string;
  try {
    reply = await prompt(agent, text);
  } catch (err) {
    await stop(agent).catch(() => {});
    throw err;
  }
  await stop(agent);
  return reply;
}
