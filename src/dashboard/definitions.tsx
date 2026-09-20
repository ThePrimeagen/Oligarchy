import type { FC } from "hono/jsx";
import { OperatorPage } from "./page.tsx";
import type { DefinitionVersions } from "./query.ts";

// Why the last edit of the selected definition was refused, when it was.
export type EditNotice = "unchanged" | "empty";

const EDIT_NOTICES: Record<EditNotice, string> = {
  unchanged: "Nothing changed: the newest wording already reads like this.",
  empty: "Every field needs text.",
};

const Definition: FC<{
  group: DefinitionVersions;
  notice: EditNotice | undefined;
}> = ({ group, notice }) => {
  const newest = group.versions[group.versions.length - 1];
  const next = group.versions.length + 1;
  // Two: the current wording and the one before it. Older wordings stay in the database.
  const shown = group.versions.slice(-2);
  return (
    <section>
      <h2>{group.name}</h2>
      {/* The class is what public/dashboard.js looks for: the button starts disabled and is
          enabled once a field differs from the wording it was rendered with. */}
      <form method="post" action="/definitions" class="definition__form">
        <input type="hidden" name="name" value={group.name} />
        <p>
          Updating writes v{next} of {group.name}; the earlier wordings keep their runs.
        </p>
        {notice === undefined ? null : <p role="alert">{EDIT_NOTICES[notice]}</p>}
        <label>
          description
          <textarea name="description" rows={3} required>
            {newest.description}
          </textarea>
        </label>
        <label>
          instruction
          <textarea name="instruction" rows={6} required>
            {newest.instruction}
          </textarea>
        </label>
        <label>
          proof
          <textarea name="proof" rows={3} required>
            {newest.proof}
          </textarea>
        </label>
        <button type="submit" disabled>
          Update
        </button>
      </form>
      {shown.toReversed().map((wording, index) => {
        const version = group.versions.length - index;
        return (
          <>
            <h3>v{version}</h3>
            <p class="wording">{wording.description}</p>
            <p class="wording">{wording.instruction}</p>
            <p class="wording">{wording.proof}</p>
          </>
        );
      })}
    </section>
  );
};

// Text, like the servers page: each name, its newest wording as a form, then the current
// wording and the one before it as paragraphs. `groups` is absent only when the database
// could not be read. `error` is that failure; a name nobody carries is said on its own.
export const DefinitionsPage: FC<{
  groups: ReadonlyArray<DefinitionVersions> | null;
  name: string | undefined;
  selected: DefinitionVersions | undefined;
  notice: EditNotice | undefined;
  error: string | undefined;
}> = ({ groups, name, selected, notice, error }) => {
  let body = null;
  if (groups !== null && groups.length === 0) {
    body = <p>no definitions</p>;
  } else if (groups !== null) {
    body = groups.map((group) => (
      <Definition group={group} notice={group.name === selected?.name ? notice : undefined} />
    ));
  }
  return (
    <OperatorPage title="oligarchy definitions" page="definitions" scriptSrc="/dashboard.js">
      <h1>oligarchy definitions</h1>
      {error === undefined ? null : <p>error: {error}</p>}
      {name !== undefined && groups !== null && selected === undefined ? (
        <p>
          No test definition named <code>{name}</code>.
        </p>
      ) : null}
      {body}
    </OperatorPage>
  );
};
