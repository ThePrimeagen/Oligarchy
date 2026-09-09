import type { ModelListItem } from "@cursor/sdk";

// Six entries of the catalog `Cursor.models.list()` answered on 2026-09-09, each cut to the
// fields the mapping reads (id, aliases, parameters); the variants are dropped. Between them they
// cover every way a vendor spells its knobs: `effort`, `reasoning` (with `extra-high` for the
// level we call `xhigh`), `reasoning_effort`, a `fast` switch, and a model with no knobs at all.
export const GROK_4_6: ModelListItem = {
  id: "grok-4.6",
  displayName: "Cursor Grok 4.6",
  parameters: [
    {
      id: "effort",
      displayName: "Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
        { value: "xhigh", displayName: "Extra High" },
      ],
    },
    {
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true", displayName: "Fast\u200b\u200b" }],
    },
  ],
};

export const COMPOSER_2_5: ModelListItem = {
  id: "composer-2.5",
  displayName: "Composer 2.5",
  aliases: ["composer-latest", "composer", "composer-2-5"],
  parameters: [
    {
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
    },
  ],
};

export const GPT_5_5: ModelListItem = {
  id: "gpt-5.5",
  displayName: "GPT-5.5",
  aliases: ["gpt-5-5"],
  parameters: [
    {
      id: "context",
      displayName: "Context",
      values: [
        { value: "272k", displayName: "272K" },
        { value: "1m", displayName: "1M" },
      ],
    },
    {
      id: "reasoning",
      displayName: "Reasoning",
      values: [
        { value: "none", displayName: "None" },
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
        { value: "extra-high", displayName: "Extra High" },
      ],
    },
    {
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
    },
  ],
};

export const GEMINI_3_8_FLASH: ModelListItem = {
  id: "gemini-3.8-flash",
  displayName: "Gemini 3.8 Flash",
  parameters: [
    {
      id: "reasoning_effort",
      displayName: "Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
      ],
    },
  ],
};

export const CLAUDE_OPUS_5: ModelListItem = {
  id: "claude-opus-5",
  displayName: "Claude Opus 5",
  aliases: ["opus-latest", "opus", "opus-5"],
  parameters: [
    { id: "thinking", displayName: "Thinking", values: [{ value: "false" }, { value: "true" }] },
    {
      id: "context",
      displayName: "Context",
      values: [
        { value: "300k", displayName: "300K" },
        { value: "1m", displayName: "1M" },
      ],
    },
    {
      id: "effort",
      displayName: "Effort",
      values: [
        { value: "low", displayName: "Low" },
        { value: "medium", displayName: "Medium" },
        { value: "high", displayName: "High" },
        { value: "xhigh", displayName: "Extra High" },
        { value: "max", displayName: "Max" },
      ],
    },
    {
      id: "fast",
      displayName: "Fast",
      values: [{ value: "false" }, { value: "true", displayName: "Fast" }],
    },
  ],
};

export const GEMINI_3_1_PRO: ModelListItem = {
  id: "gemini-3.1-pro",
  displayName: "Gemini 3.1 Pro",
  aliases: ["gemini-latest", "gemini-pro-latest", "gemini", "gemini-pro"],
};

export const CATALOG: ReadonlyArray<ModelListItem> = [
  GROK_4_6,
  COMPOSER_2_5,
  GPT_5_5,
  GEMINI_3_8_FLASH,
  CLAUDE_OPUS_5,
  GEMINI_3_1_PRO,
];
