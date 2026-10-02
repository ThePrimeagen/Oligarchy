import { basename, dirname } from "node:path";
import type { Os } from "../src/io.ts";
export const files = () => {
  const data = new Map<string, Buffer>();
  const directories = new Set<string>(["/", "/cache"]);
  const faults = new Map<string, Error>();
  const calls: string[] = [];
  const missing = (path: string) => Object.assign(new Error(path), { code: "ENOENT" });
  const fault = (op: string, path: string) => {
    calls.push(`${op} ${path}`);
    const error = faults.get(`${op} ${path}`);
    if (error) throw error;
  };
  function readFile(path: string): Promise<Uint8Array>;
  function readFile(path: string, encoding: "utf8"): Promise<string>;
  async function readFile(path: string, encoding?: "utf8"): Promise<Uint8Array | string> {
    fault("read", path);
    const value = data.get(path);
    if (!value) throw missing(path);
    return encoding ? value.toString() : value;
  }
  const fs: Os["fs"] = {
    stat: async (path: string) => {
      fault("stat", path);
      if (!data.has(path) && !directories.has(path)) throw missing(path);
      return { isFile: () => data.has(path), mtimeMs: 0 };
    },
    access: async (path: string) => {
      fault("access", path);
    },
    readFile,
    writeFile: async (path: string, value: string | Uint8Array) => {
      fault("write", path);
      data.set(path, Buffer.from(value));
    },
    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      fault("mkdir", path);
      if (directories.has(path) && !options?.recursive)
        throw Object.assign(new Error(path), { code: "EEXIST" });
      directories.add(path);
    },
    rename: async (from: string, to: string) => {
      fault("rename", to);
      if (directories.has(from)) {
        directories.delete(from);
        directories.add(to);
        for (const [key, value] of [...data]) {
          if (!key.startsWith(`${from}/`)) continue;
          data.set(`${to}${key.slice(from.length)}`, value);
          data.delete(key);
        }
      } else {
        const value = data.get(from);
        if (value === undefined) throw missing(from);
        data.set(to, value);
        data.delete(from);
      }
    },
    copyFile: async (from: string, to: string) => {
      fault("copy", to);
      const value = data.get(from);
      if (value === undefined) throw missing(from);
      data.set(to, Buffer.from(value));
    },
    rm: async (path: string, options?: { recursive?: boolean }) => {
      fault("rm", path);
      data.delete(path);
      directories.delete(path);
      if (options?.recursive)
        for (const key of data.keys()) if (key.startsWith(`${path}/`)) data.delete(key);
    },
    readdir: async (path: string) =>
      [...directories, ...data.keys()]
        .filter((key) => key !== path && dirname(key) === path)
        .map((entry) => basename(entry)),
    open: async (path: string) => {
      fault("open", path);
      data.set(path, Buffer.alloc(0));
      return {
        writeFile: async (chunk: Uint8Array) => {
          fault("write", path);
          data.set(path, Buffer.concat([data.get(path)!, chunk]));
        },
        sync: async () => {},
        close: async () => {},
      };
    },
  };
  const os: Os = {
    fs,
    spawn: () => {
      throw new Error("unexpected spawn");
    },
    kill: () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  };
  return { os, data, faults, calls, directories };
};
