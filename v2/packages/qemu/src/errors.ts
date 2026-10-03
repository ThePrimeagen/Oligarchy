import * as Async from "@oligarchy/async";
import * as jarl from "jarl";
export const QemuFailed = jarl.error.define("QemuFailed");
export type QemuFailed = InstanceType<typeof QemuFailed>;
export type Failure = QemuFailed | Async.Aborted;
export const failed = (cause: unknown): Failure => {
  if (jarl.error.is(cause, Async.Aborted) || jarl.error.is(cause, QemuFailed)) return cause;
  const error = new QemuFailed(cause instanceof Error ? cause.message : String(cause));
  error.cause = cause;
  return error;
};
export const check = (signal: AbortSignal) => {
  if (signal.aborted)
    throw jarl.error.is(signal.reason, Async.Aborted)
      ? signal.reason
      : new Async.Aborted("aborted");
};
export type Answer<T> = Promise<jarl.Result<T, Failure>>;

export const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
export const captured = (error: unknown): { serial: string; qemu: string } | undefined => {
  if (typeof error !== "object" || error === null || !("captured" in error)) return undefined;
  const value = error.captured;
  if (
    typeof value !== "object" ||
    value === null ||
    !("serial" in value) ||
    !("qemu" in value) ||
    typeof value.serial !== "string" ||
    typeof value.qemu !== "string"
  )
    return undefined;
  return { serial: value.serial, qemu: value.qemu };
};
