import { describe, expect, it } from "vitest";
import * as Template from "../src/template.ts";

const INPUTS: Template.Inputs = {
  pglite: "0.5.8",
  migrations: [
    { name: "0001_init.sql", text: "create table logs ();" },
    { name: "meta/_journal.json", text: '{"entries":[{"tag":"0001_init"}]}' },
  ],
};

describe("the migrated template's cache key", () => {
  it("is the same for the same migrations and PGlite, in whatever order the files were read (happy)", () => {
    const reversed = { ...INPUTS, migrations: [...INPUTS.migrations].reverse() };

    expect(Template.key(reversed)).toBe(Template.key(INPUTS));
  });

  it("changes when a migration's text changes, so a stale database is never served (unhappy)", () => {
    const edited = {
      ...INPUTS,
      migrations: [
        { name: "0001_init.sql", text: "create table logs (id int);" },
        ...INPUTS.migrations.slice(1),
      ],
    };

    expect(Template.key(edited)).not.toBe(Template.key(INPUTS));
  });

  it("changes when a migration is added (unhappy)", () => {
    const added = {
      ...INPUTS,
      migrations: [...INPUTS.migrations, { name: "0002_more.sql", text: "create table more ();" }],
    };

    expect(Template.key(added)).not.toBe(Template.key(INPUTS));
  });

  it("changes when PGlite changes, whose data directory may not load in another version (unhappy)", () => {
    expect(Template.key({ ...INPUTS, pglite: "0.6.0" })).not.toBe(Template.key(INPUTS));
  });

  it("does not let one file's text run into the next file's name (unhappy)", () => {
    const shifted = {
      ...INPUTS,
      migrations: [
        { name: "a", text: "bc" },
        { name: "d", text: "" },
      ],
    };
    const other = {
      ...INPUTS,
      migrations: [
        { name: "a", text: "b" },
        { name: "cd", text: "" },
      ],
    };

    expect(Template.key(shifted)).not.toBe(Template.key(other));
  });
});
