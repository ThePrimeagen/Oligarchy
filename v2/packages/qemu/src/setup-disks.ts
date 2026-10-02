import { codeOf } from "./errors.ts";
import { join } from "node:path";
import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import type * as Iso from "./iso.ts";
import type * as Qemu from "./qemu.ts";
import * as Io from "./io.ts";
import { type Answer, failed, check, QemuFailed } from "./errors.ts";
export type SetupDisks = {
  readonly service: "setupDisks";
  readonly find: (iso: string) => Answer<Qemu.Pair | undefined>;
  readonly save: (iso: string, pair: Qemu.Pair, signal: AbortSignal) => Answer<void>;
};
declare module "@oligarchy/app" {
  interface Services {
    setupDisks: App.Register<"setupDisks", SetupDisks>;
  }
}
export const create = App.createService<Iso.Iso | Qemu.Qemu, { readonly os?: Io.Os }, SetupDisks>(
  (services, options) => {
    const os = options.os ?? Io.node;
    const exists = async (path: string) => {
      try {
        const info = await os.fs.stat(path);
        if (!info.isFile()) throw new QemuFailed(`${path} is not a file`);
        return true;
      } catch (error) {
        if (codeOf(error) === "ENOENT") return false;
        throw error;
      }
    };
    return {
      service: "setupDisks",
      find: (iso) =>
        jarl.exec(async () => {
          const path = services.iso.pathOf(iso),
            root = `${path}.setups`;
          if (await exists(join(root, "current.json"))) {
            const version: unknown = JSON.parse(
              await os.fs.readFile(join(root, "current.json"), "utf8"),
            );
            if (typeof version !== "string" || !/^[a-f0-9-]{36}$/.test(version))
              throw new QemuFailed("invalid setup version");
            const pair = {
              disk: join(root, version, "disk.qcow2"),
              vars: join(root, version, "OVMF_VARS.fd"),
            };
            if (!(await exists(pair.disk)) || !(await exists(pair.vars)))
              throw new QemuFailed("incomplete setup disk version");
            return pair;
          }
          const legacy = { disk: `${path}.qcow2`, vars: `${path}.OVMF_VARS.fd` };
          return (await exists(legacy.disk)) && (await exists(legacy.vars)) ? legacy : undefined;
        }, failed),
      save: (iso, pair, signal) =>
        jarl.exec(async () => {
          check(signal);
          const root = `${services.iso.pathOf(iso)}.setups`,
            version = crypto.randomUUID();
          const dir = join(root, version),
            pointer = join(root, `current-${version}.partial`);
          let published = false;
          try {
            await os.fs.mkdir(dir, { recursive: true });
            await os.fs.copyFile(pair.vars, join(dir, "OVMF_VARS.fd"));
            jarl.unwrap(await services.qemu.convert(pair.disk, join(dir, "disk.qcow2"), signal));
            check(signal);
            await os.fs.writeFile(pointer, JSON.stringify(version));
            await os.fs.rename(pointer, join(root, "current.json"));
            published = true;
            // Old versions remain immutable because a running overlay may still reference one.
          } finally {
            await os.fs.rm(pointer, { force: true });
            if (!published) await os.fs.rm(dir, { recursive: true, force: true });
          }
        }, failed),
    };
  },
);
