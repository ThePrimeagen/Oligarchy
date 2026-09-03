import { Agent, type ModelSelection } from "@cursor/sdk";

const REPOSITORY = "https://github.com/ThePrimeagen/Oligarchy";

const GROK_4_6_FAST_XHIGH: ModelSelection = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "xhigh" },
    { id: "fast", value: "true" },
  ],
};

export type PromptOptions = {
  model?: ModelSelection;
};

export async function prompt(text: string, options: PromptOptions = {}): Promise<void> {
  const apiKey = process.env.CURSOR_API_TOKEN;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("cursor-agent: CURSOR_API_TOKEN is not set");
  }
  const agent = await Agent.create({
    apiKey,
    model: options.model ?? GROK_4_6_FAST_XHIGH,
    cloud: { repos: [{ url: REPOSITORY }] },
  });
  // send resolves once the cloud run exists; the agent keeps working after this returns.
  try {
    await agent.send(text);
  } finally {
    agent.close();
  }
  console.log(`Agent here, go check it out for more information: https://cursor.com/agents/${agent.agentId}`);
}
