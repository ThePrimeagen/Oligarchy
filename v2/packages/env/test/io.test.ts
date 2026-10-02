import * as jarl from "jarl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Errors from "../src/errors.ts";
import * as Io from "../src/io.ts";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("node readFile", () => {
  it("reads UTF-8 text and takes the arguments after the executable and script (happy)", async () => {
    const reads: Array<readonly [string, string]> = [];
    const io = Io.node({
      argv: ["bun", "main.ts", "--name", "client"],
      env: { NAME: "client" },
      readFile: async (path, encoding) => {
        reads.push([path, encoding]);
        return "NAME=client\n";
      },
    });

    expect(jarl.unwrap(await io.readFile("/config.env"))).toBe("NAME=client\n");
    expect(reads).toEqual([["/config.env", "utf8"]]);
    expect(io.argv).toEqual(["--name", "client"]);
    expect(io.env).toEqual({ NAME: "client" });
  });

  it("answers FileMissing for a path that does not exist (unhappy)", async () => {
    const path = "/missing.env";
    const io = Io.node({
      argv: [],
      env: {},
      readFile: async () => {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      },
    });
    const read = await io.readFile(path);
    if (!jarl.error.is(read, Errors.FileMissing)) {
      throw new Error("expected FileMissing");
    }
    expect(read.error.path).toBe(path);
    expect(read.error.message).toBe(`${path}: file is missing`);
  });

  it("answers FileUnreadable for a path that exists but is not a file (unhappy)", async () => {
    const path = "/directory";
    const cause = Object.assign(new Error("EISDIR: illegal operation on a directory, read"), {
      code: "EISDIR",
    });
    const io = Io.node({
      argv: [],
      env: {},
      readFile: async () => {
        throw cause;
      },
    });
    const read = await io.readFile(path);
    if (!jarl.error.is(read, Errors.FileUnreadable)) {
      throw new Error("expected FileUnreadable");
    }
    expect(read.error.path).toBe(path);
    expect(read.error.message).toBe(`${path}: ${cause.message}`);
    expect(read.error.cause).toBe(cause);
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
