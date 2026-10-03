import * as App from "@oligarchy/app";
import * as jarl from "jarl";
import type * as Qemu from "./qemu.ts";
import type * as Iso from "./iso.ts";
import type * as SetupDisks from "./setup-disks.ts";
import type * as QmpListen from "./qmp-listen.ts";
import { QemuFailed } from "./errors.ts";
const unexpected = () => Promise.resolve(jarl.err(new QemuFailed("unexpected QEMU operation")));
export const qemu = (overrides: Partial<Omit<Qemu.Qemu, "service">> = {}) =>
  App.createService<never, App.NoOptions, Qemu.Qemu>(() => ({
    service: "qemu",
    recover: unexpected,
    boot: unexpected,
    convert: unexpected,
    ...overrides,
  }))({});
export const iso = (overrides: Partial<Omit<Iso.Iso, "service">> = {}) =>
  App.createService<never, App.NoOptions, Iso.Iso>(() => ({
    service: "iso",
    pathOf: (name) => `/cache/${encodeURIComponent(name)}`,
    get: unexpected,
    close: async () => {},
    ...overrides,
  }))({});
export const setupDisks = (overrides: Partial<Omit<SetupDisks.SetupDisks, "service">> = {}) =>
  App.createService<never, App.NoOptions, SetupDisks.SetupDisks>(() => ({
    service: "setupDisks",
    find: unexpected,
    save: unexpected,
    ...overrides,
  }))({});
export const qmpListen = (overrides: Partial<Omit<QmpListen.QmpListen, "service">> = {}) =>
  App.createService<never, App.NoOptions, QmpListen.QmpListen>(() => ({
    service: "qmpListen",
    listen: unexpected,
    ...overrides,
  }))({});
