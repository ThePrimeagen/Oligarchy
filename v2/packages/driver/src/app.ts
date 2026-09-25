import * as Env from "@oligarchy/env";
import * as z from "zod";

export const app = {
  name: "driver",
  description: "Run the harness loop for one prompt",
  flags: {
    action: Env.flag.string({
      description: "drive or mint; the model is that action's in oligarchy.json",
      schema: z.enum(["drive", "mint"]),
    }),
    prompt: Env.flag.string({ description: "The user prompt" }),
    agentId: Env.flag.string({
      description: "Ticket the harness looks up and passes as --agent-id",
    }),
    debugLog: Env.flag.optional(
      Env.flag.string({ description: "File that receives one JSON line per step" }),
    ),
    serverUrl: Env.flag.serverUrl,
  },
  needs: ["openRouterToken", "databaseUrl"] as const,
};
