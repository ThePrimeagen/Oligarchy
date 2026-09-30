import * as jarl from "jarl";

// A 409 from the guest's screen, keys or mouse: the guest is off, as a mint's last act leaves it.
export const GuestOff = jarl.error.define("GuestOff");
export type GuestOff = InstanceType<typeof GuestOff>;

// A 409 from intent start: the job's last intent is still open.
export const IntentOpen = jarl.error.define("IntentOpen");
export type IntentOpen = InstanceType<typeof IntentOpen>;

// A 409 from save: the guest did not power off, so its disk was not kept.
export const NotPoweredOff = jarl.error.define("NotPoweredOff");
export type NotPoweredOff = InstanceType<typeof NotPoweredOff>;

// A click, double-click, drag or nudge before any mouse call placed the pointer. Nothing was sent.
export const NoPointer = jarl.error.define("NoPointer");
export type NoPointer = InstanceType<typeof NoPointer>;

// A tool call run cannot make: no tool by that name, or arguments its schema refuses. Nothing
// was sent.
export const ToolInvalid = jarl.error.define("ToolInvalid");
export type ToolInvalid = InstanceType<typeof ToolInvalid>;
