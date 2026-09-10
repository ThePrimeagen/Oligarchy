import { Array as Arr, Effect, FileSystem, Option, Result } from "effect";
import * as Errors from "../shared/errors.ts";

// The Cursor model id a driving or diagnosing agent is told it is running as.
export const MODEL = "cursor-grok-4.6-high-fast";

const besideModule = (relative: string): string =>
  decodeURIComponent(new URL(relative, import.meta.url).pathname);

// The guides a template may embed, by the name it uses. Read only when named, so an unreadable
// guide cannot stop a rendering whose template does not embed it.
const GUIDES: Readonly<Record<string, string>> = {
  CTRL_DIAGNOSE_MD: besideModule("../../ctrl-diagnose.md"),
};

const PLACEHOLDER = /\{\{([A-Z_]+)\}\}/g;

const read = Effect.fn("Prompts.read")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(
      Effect.mapError((error) =>
        Errors.PromptError.make({ message: `prompt: ${error.message}`, cause: error }),
      ),
    );
});

const fill = (
  template: string,
  text: string,
  values: Readonly<Record<string, string>>,
): Result.Result<string, Errors.PromptError> => {
  const missing: Array<string> = [];
  const filled = text.replace(PLACEHOLDER, (match: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      missing.push(name);
      return match;
    }
    return value;
  });
  return Option.match(Arr.head(missing), {
    onNone: () => Result.succeed(filled),
    onSome: (name) =>
      Result.fail(
        Errors.PromptError.make({
          message: `prompt: prompts/${template} uses {{${name}}}, which has no value`,
        }),
      ),
  });
};

const render = Effect.fn("Prompts.render")(function* (
  template: string,
  values: Readonly<Record<string, string>>,
) {
  const text = yield* read(besideModule(`../../prompts/${template}`));
  const known: Record<string, string> = { ...values };
  for (const [name, path] of Object.entries(GUIDES)) {
    if (text.includes(`{{${name}}}`)) {
      known[name] = (yield* read(path)).trimEnd();
    }
  }
  return yield* Effect.fromResult(fill(template, text, known));
});

export const drive = Effect.fn("Prompts.drive")(function* (ticket: string) {
  return yield* render("driving-agent.html", { LINEAR_TICKET: ticket, MODEL });
});

export const diagnose = Effect.fn("Prompts.diagnose")(function* (ticket: string, resultId: string) {
  return yield* render("diagnosing-agent.html", {
    LINEAR_TICKET: ticket,
    RESULT_ID: resultId,
    MODEL,
  });
});
