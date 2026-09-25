import { fileURLToPath } from "node:url";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Errors from "../src/errors.ts";
import * as Io from "../src/io.ts";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

describe("node readFile", () => {
  it("reads a file as text (happy)", async () => {
    const read = await Io.node().readFile(here("../package.json"));
    if (!jarl.is_ok(read)) {
      throw read.error;
    }
    expect(read.value).toContain('"name": "@oligarchy/env"');
  });

  it("answers FileMissing for a path that does not exist (unhappy)", async () => {
    const path = here("./does-not-exist.env");
    const read = await Io.node().readFile(path);
    if (!jarl.error.is(read, Errors.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(read.error.message).toBe(`${path}: file is missing`);
  });

  it("answers FileUnreadable for a path that exists but is not a file (unhappy)", async () => {
    const path = here(".");
    const read = await Io.node().readFile(path);
    if (!jarl.error.is(read, Errors.FileUnreadable)) {
      throw new Error("expected FileUnreadable");
    }
    expect(read.error.message).toMatch(new RegExp(`^${path}: `));
  });
});

describe("fake", () => {
  it("answers the files it was given and records every read (happy)", async () => {
    const io = Io.fake({ argv: ["--x"], env: { A: "1" }, files: { ".env": "A=2\n" } });
    expect(await jarl.unwrap(io.readFile(".env"))).toBe("A=2\n");
    expect(io.argv).toEqual(["--x"]);
    expect(io.env).toEqual({ A: "1" });
    expect(io.reads).toEqual([".env"]);
  });

  it("answers FileMissing for a file it was not given (unhappy)", async () => {
    expect(jarl.error.is(await Io.fake().readFile(".env"), Errors.FileMissing)).toBe(true);
  });

  it("answers FileUnreadable for a file marked unreadable (unhappy)", async () => {
    const io = Io.fake({ files: { ".env": "A=1\n" }, unreadable: [".env"] });
    expect(jarl.error.is(await io.readFile(".env"), Errors.FileUnreadable)).toBe(true);
  });
});
