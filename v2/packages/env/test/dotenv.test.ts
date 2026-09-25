import { describe, expect, it } from "vitest";
import * as Dotenv from "../src/dotenv.ts";

describe("parse", () => {
  it("reads plain, exported, quoted and commented lines (happy)", () => {
    const text = [
      "# a comment",
      "PLAIN=value",
      "export EXPORTED=yes",
      "SINGLE='single quoted'",
      'DOUBLE="line\\nbreak"',
      "TRAILING=kept # dropped",
      "SPACED = padded ",
    ].join("\n");
    expect(Dotenv.parse(text)).toEqual({
      PLAIN: "value",
      EXPORTED: "yes",
      SINGLE: "single quoted",
      DOUBLE: "line\nbreak",
      TRAILING: "kept",
      SPACED: "padded",
    });
  });

  it("keeps $ literal and a single-quoted escape raw (happy)", () => {
    expect(Dotenv.parse("TOKEN=to$ken\nRAW='a\\nb'\n")).toEqual({ TOKEN: "to$ken", RAW: "a\\nb" });
  });

  it("reads a file written with CRLF line endings (happy)", () => {
    expect(Dotenv.parse("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });

  it("skips lines that are not assignments (unhappy)", () => {
    expect(Dotenv.parse("not an assignment\n=novalue\nGOOD=1\n")).toEqual({ GOOD: "1" });
  });

  it("reads an assignment with no value as empty (unhappy)", () => {
    expect(Dotenv.parse("EMPTY=\nNEXT=1\n")).toEqual({ EMPTY: "", NEXT: "1" });
  });
});
