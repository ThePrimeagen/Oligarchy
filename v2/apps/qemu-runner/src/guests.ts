import type * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import type * as Sentry from "@oligarchy/sentry";
import type * as Logger from "@oligarchy/logger";
import * as Q from "@oligarchy/qemu";
import type { Handler, Requests } from "@oligarchy/qemu/routes";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

export type Wants =
  | Q.Qemu.Qemu
  | Q.Iso.Iso
  | Q.SetupDisks.SetupDisks
  | Stores.Tests.Tests
  | Stores.Actions.Actions
  | Stores.VmStatus.VmStatus
  | Stores.DebugLogs.DebugLogs
  | Logger.Logger
  | Sentry.Sentry;
export type Options = { readonly maxJobs: number; readonly config: Env.Config["qemuRunner"] };
type Entry = {
  job: string;
  controller: AbortController;
  phase: "reserved" | "starting" | "running" | "saving" | "stopping";
  touched: number;
  guest?: Q.Qemu.Guest;
  iso?: string;
  runId?: string;
  intent?: string;
  trace?: Sentry.Span;
  intentSpan?: Sentry.Span;
  result?: Sentry.SpanStatus;
  latestImage?: { id: string; actionId: number };
  captured?: boolean;
  terminal?: Q.Qemu.End;
  work: Promise<unknown>;
  stopping?: Promise<Response>;
  events: Set<ReturnType<typeof Q.Queue.create<string>>>;
  recording: Promise<void>;
};
const json = (value: unknown = {}, status = 200) => Response.json(value, { status });
const error = (message: string, status: number) => json({ error: message }, status);

export const create = (services: App.Needs<Wants>, options: Options) => {
  const held = new Map<string, Entry>();
  let closing = false;
  const at = (entry: Entry) => ({
    location: "qemu-runner",
    jobId: entry.job,
    ...(entry.runId === undefined ? {} : { runId: entry.runId }),
  });
  const event = (entry: Entry, type: string, data: unknown) => {
    const line = `${JSON.stringify({ job: entry.job, type, data, at: Date.now() })}\n`;
    for (const queue of entry.events) queue.push(line);
  };
  const report = (entry: Entry, message: string, cause: unknown) =>
    services.logger.error(message, { ...at(entry), cause });
  const recorder =
    (entry: Entry): Q.Qmp.Recorder =>
    (command) =>
      jarl.exec(async () => {
        const id = jarl.unwrap(
          await services.actions.startAction({ jobId: entry.job, request: command }),
        );
        const span = (entry.intentSpan ?? entry.trace)?.trace(command.execute, {
          op: "qmp",
          attributes: { actionId: id },
        });
        return (outcome) =>
          jarl.exec(async () => {
            try {
              jarl.unwrap(await services.actions.finishAction(id, outcome));
              event(entry, "action", { id, command, ...outcome });
            } finally {
              span?.end(outcome.state === "completed" ? "ok" : "internal_error");
            }
          }, Q.failed);
      }, Q.failed);
  const terminal = (entry: Entry, end: Q.Qemu.End) => {
    if (entry.terminal !== undefined) return;
    entry.terminal = end;
    if (end.status === "panicked" || end.status === "crashed" || end.status === "server-error")
      entry.result = "internal_error";
    event(entry, "vm", end);
    entry.recording = entry.recording.then(async () => {
      const result = await services.vmStatus.stop(entry.job, end);
      if (jarl.is_err(result)) report(entry, result.error.message, result.error);
    });
  };
  const capture = async (entry: Entry) => {
    if (entry.guest === undefined || entry.captured) return;
    const captured = await entry.guest.capture();
    if (jarl.is_err(captured)) {
      report(entry, "could not capture guest logs", captured.error);
      return;
    }
    await services.logger.flush();
    const saved = await services.debugLogs.saveDebugLog(entry.job, jarl.value(captured));
    if (jarl.is_err(saved)) report(entry, "could not save guest logs", saved.error);
    else entry.captured = true;
  };
  const stop = (entry: Entry): Promise<Response> => {
    if (entry.stopping !== undefined) return entry.stopping;
    entry.controller.abort(new Async.Aborted(`job ${entry.job} stopped`));
    entry.phase = "stopping";
    entry.stopping = (async () => {
      await entry.work;
      if (entry.guest !== undefined) {
        const stopped = await entry.guest.stop();
        if (jarl.is_err(stopped)) {
          report(entry, "guest stop failed", stopped.error);
          delete entry.stopping;
          return error(stopped.error.message, 502);
        }
        terminal(entry, await entry.guest.end);
        await capture(entry);
        const disposed = await entry.guest.dispose();
        if (jarl.is_err(disposed)) report(entry, "guest files cleanup failed", disposed.error);
      }
      if (entry.intent !== undefined) {
        services.logger.info("intent end", at(entry));
        delete entry.intent;
      }
      entry.intentSpan?.end("aborted");
      delete entry.intentSpan;
      await entry.recording;
      for (const queue of entry.events) queue.finish();
      entry.events.clear();
      entry.trace?.end(entry.result ?? (entry.terminal?.status === "shutdown" ? "ok" : "aborted"));
      held.delete(entry.job);
      return json();
    })();
    return entry.stopping;
  };
  const abort = async ({ job }: Requests["abort"]) => {
    const entry = held.get(job);
    return entry === undefined ? error("job not held", 404) : stop(entry);
  };
  const reserve = async (input: Requests["reserve"]) => {
    if (closing || held.size >= options.maxJobs) return error("at capacity", 503);
    if (held.has(input.job)) return error("job already held", 400);
    const entry: Entry = {
      job: input.job,
      controller: new AbortController(),
      phase: "reserved",
      touched: Date.now(),
      work: Promise.resolve(),
      recording: Promise.resolve(),
      events: new Set(),
    };
    held.set(input.job, entry);
    const work = (async () => {
      const found = await services.tests.getJobDetails(input.job);
      if (jarl.is_err(found)) {
        held.delete(input.job);
        return error(found.error.message, 400);
      }
      entry.runId = jarl.value(found).run.id;
      if (input.resume !== undefined) {
        const pair = await services.setupDisks.find(input.resume);
        if (jarl.is_err(pair)) {
          held.delete(input.job);
          return error(pair.error.message, 502);
        }
        if (jarl.value(pair) === undefined) {
          held.delete(input.job);
          return error("setup needed", 409);
        }
      }
      return entry.controller.signal.aborted ? error("reservation aborted", 409) : json();
    })();
    entry.work = work;
    return work;
  };
  const start = async (input: Requests["start"]) => {
    const entry = held.get(input.job);
    if (entry === undefined) return error("job not held", 404);
    if (entry.phase !== "reserved" || entry.controller.signal.aborted)
      return error("job already started", 409);
    entry.trace = services.sentry.trace("qemu guest", { jobId: entry.job, op: "qemu" });
    entry.phase = "starting";
    entry.iso = input.iso;
    entry.touched = Date.now();
    const work = jarl.exec(async () => {
      const details = jarl.unwrap(await services.tests.getJobDetails(input.job));
      if (
        details.run.iso !== input.iso ||
        (details.job.action !== "setup" && details.job.action !== "drive")
      )
        throw new Q.QemuFailed("start does not match job");
      const expectedMode =
        details.job.action === "drive" && details.definition.resume ? "resume" : "fresh";
      if (input.mode !== expectedMode) throw new Q.QemuFailed("boot mode does not match job");
      jarl.unwrap(await services.vmStatus.record(entry.job, "downloading"));
      const signal = entry.controller.signal;
      const base =
        input.mode === "resume"
          ? jarl.unwrap(await services.setupDisks.find(input.iso))
          : undefined;
      if (input.mode === "resume" && base === undefined)
        throw new Q.QemuFailed("setup disk missing");
      const cdrom =
        base === undefined ? jarl.unwrap(await services.iso.get(input.iso, signal)) : undefined;
      const guest = jarl.unwrap(
        await services.qemu.boot(
          {
            job: entry.job,
            record: recorder(entry),
            ...(base === undefined ? {} : { base }),
            ...(cdrom === undefined ? {} : { cdrom }),
          },
          signal,
        ),
      );
      entry.guest = guest;
      jarl.unwrap(await services.vmStatus.record(entry.job, "running"));
      void guest.end.then((end) => {
        terminal(entry, end);
        if (end.status !== "shutdown" && !entry.controller.signal.aborted) void stop(entry);
      });
      if (!signal.aborted) entry.phase = "running";
      return json();
    }, Q.failed);
    entry.work = work;
    const result = await work;
    if (jarl.is_err(result)) {
      entry.trace?.fail(result.error);
      report(entry, "guest start failed", result.error);
      if (Q.captured(result.error) !== undefined) {
        const captured = Q.captured(result.error);
        await services.logger.flush();
        const saved = await services.debugLogs.saveDebugLog(entry.job, captured!);
        if (jarl.is_err(saved)) report(entry, "could not save failed startup logs", saved.error);
        else entry.captured = true;
      }
      terminal(
        entry,
        entry.controller.signal.aborted
          ? { status: "stopped" }
          : { status: "server-error", reason: result.error.message },
      );
      await stop(entry);
      return error(result.error.message, 502);
    }
    return jarl.value(result);
  };
  const save = async (entry: Entry) => {
    if (entry.phase !== "running" || entry.guest === undefined || entry.iso === undefined)
      return error("guest unavailable", 409);
    entry.phase = "saving";
    const previous = entry.work;
    const work = jarl.exec(async () => {
      await previous;
      Q.check(entry.controller.signal);
      const details = jarl.unwrap(await services.tests.getJobDetails(entry.job));
      if (details.job.action !== "setup") return error("only setup jobs may save", 409);
      const guest = entry.guest!;
      if (entry.terminal === undefined) {
        const ended = await Async.timeout(
          async (signal) => {
            let onAbort = () => {};
            const aborted = new Promise<Q.Qemu.End>((_, reject) => {
              onAbort = () => reject(signal.reason);
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
              return await jarl.exec(() => Promise.race([guest.end, aborted]), Q.failed);
            } finally {
              signal.removeEventListener("abort", onAbort);
            }
          },
          { ms: options.config.poweroffTimeout, signal: entry.controller.signal },
        );
        if (jarl.is_err(ended)) return error("guest has not powered off", 409);
        terminal(entry, jarl.value(ended));
      }
      if (entry.terminal?.status !== "shutdown")
        return error("guest did not shut down cleanly", 409);
      jarl.unwrap(await guest.stop());
      jarl.unwrap(await services.setupDisks.save(entry.iso!, guest, entry.controller.signal));
      await capture(entry);
      return json();
    }, Q.failed);
    entry.work = work;
    const result = await work;
    if (!entry.controller.signal.aborted) entry.phase = "running";
    if (jarl.is_err(result)) return error(result.error.message, 502);
    return jarl.value(result);
  };
  const handle: Handler = async (...request) => {
    const [operation, input, signal] = request;
    if (operation === "reserve") return reserve(input);
    if (operation === "stats")
      return json({
        jobs: held.size,
        qemus: [...held.values()].filter((e) => e.guest !== undefined).length,
        maxJobs: options.maxJobs,
        available: closing ? 0 : options.maxJobs - held.size,
      });
    if (operation === "setup-disks") {
      const found = await services.setupDisks.find(input.iso);
      return jarl.is_err(found)
        ? error(found.error.message, 502)
        : json({ available: jarl.value(found) !== undefined });
    }
    if (!("job" in input)) return error("missing job", 400);
    if (operation === "abort") return abort({ job: input.job });
    if (operation === "stop") {
      const entry = held.get(input.job);
      if (entry !== undefined) {
        entry.result = "ok";
        if (input.status === "aborted") entry.result = "aborted";
        else if (input.status === "failed") entry.result = "internal_error";
        services.logger.info(
          `driver ended ${input.status}${input.reason === undefined ? "" : `; ${input.reason}`}`,
          at(entry),
        );
      }
      return abort({ job: input.job });
    }
    if (operation === "relinquish") return abort({ job: input.job });
    if (operation === "start") return start(input);
    const entry = held.get(input.job);
    if (entry === undefined) return error("job not held", 404);
    entry.touched = Date.now();
    if (operation === "save") return save(entry);
    if (operation === "follow") {
      const queue = Q.Queue.create<string>(options.config.followBacklog);
      entry.events.add(queue);
      queue.push(
        `${JSON.stringify({ job: entry.job, type: "state", data: entry.terminal ?? { status: entry.phase } })}\n`,
      );
      const dispose = () => {
        entry.events.delete(queue);
        queue.finish();
        signal.removeEventListener("abort", dispose);
      };
      if (entry.intent !== undefined)
        queue.push(
          `${JSON.stringify({ job: entry.job, type: "intent/start", data: entry.intent })}\n`,
        );
      if (entry.latestImage !== undefined)
        queue.push(
          `${JSON.stringify({ job: entry.job, type: "image", data: entry.latestImage })}\n`,
        );
      signal.addEventListener("abort", dispose, { once: true });
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            const next = await queue.read(signal);
            if (jarl.is_err(next)) {
              dispose();
              controller.error(next.error);
              return;
            }
            const line = jarl.value(next);
            if (line === undefined) {
              dispose();
              controller.close();
            } else controller.enqueue(new TextEncoder().encode(line));
          },
          cancel: dispose,
        }),
        { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" } },
      );
    }
    if (operation === "intent/start") {
      if (entry.intent !== undefined) return error("intent already open", 409);
      entry.intent = input.message;
      if (entry.trace !== undefined)
        entry.intentSpan = entry.trace.trace("intent", {
          op: "intent",
          attributes: { message: input.message },
        });
      services.logger.info(`intent start; ${entry.intent}`, at(entry));
      event(entry, "intent/start", entry.intent);
      return json();
    }
    if (operation === "intent/end") {
      services.logger.info("intent end", at(entry));
      delete entry.intent;
      entry.intentSpan?.end("ok");
      delete entry.intentSpan;
      event(entry, "intent/end", null);
      return json();
    }
    if (entry.guest === undefined) return error("guest unavailable", 409);
    if (operation === "serial") {
      const captured = await entry.guest.capture();
      return jarl.is_err(captured)
        ? error(captured.error.message, 502)
        : new Response(jarl.value(captured).serial, { headers: { "content-type": "text/plain" } });
    }
    if (entry.phase !== "running" || entry.terminal !== undefined) return error("guest off", 409);
    // Commands share a queue with stop/save. An abort interrupts their QMP wait before disposal.
    const previous = entry.work;
    const working = jarl.exec(async () => {
      await previous;
      Q.check(entry.controller.signal);
      const guest = entry.guest!;
      if (operation === "image") {
        const id = jarl.unwrap(
          await services.actions.startAction({
            jobId: entry.job,
            request: { execute: "screendump" },
          }),
        );
        const image = await guest.image(entry.controller.signal, () =>
          Promise.resolve(jarl.ok(() => Promise.resolve(jarl.ok(undefined)))),
        );
        if (jarl.is_err(image)) {
          jarl.unwrap(
            await services.actions.finishAction(id, {
              state: "failed",
              response: image.error.message,
            }),
          );
          throw image.error;
        }
        const imageId = crypto.randomUUID();
        jarl.unwrap(
          await services.actions.finishAction(
            id,
            { state: "completed", response: { imageId } },
            { id: imageId, data: jarl.value(image) },
          ),
        );
        entry.latestImage = { id: imageId, actionId: id };
        event(entry, "image", entry.latestImage);
        return new Response(Buffer.from(jarl.value(image)), {
          headers: {
            "content-type": "image/png",
            "x-image-id": imageId,
            "x-image-url": `/image?job=${entry.job}`,
          },
        });
      }
      if (operation === "send-keys")
        jarl.unwrap(await guest.keys(input.keys, entry.controller.signal, recorder(entry)));
      else if (operation.startsWith("mouse/")) {
        const gesture = { ...input, kind: operation.slice(6) };
        if (("ticks" in input ? input.ticks : 0) > options.config.maxTicks)
          return error("too many scroll ticks", 400);
        jarl.unwrap(await guest.mouse(gesture, entry.controller.signal, recorder(entry)));
      }
      return json();
    }, Q.failed);
    entry.work = working;
    const result = await working;
    return jarl.is_err(result) ? error(result.error.message, 502) : jarl.value(result);
  };
  return {
    handle,
    abort,
    counts: () => ({
      jobs: held.size,
      qemus: [...held.values()].filter((e) => e.guest !== undefined).length,
    }),
    sweep: async () => {
      for (const entry of held.values()) {
        const limit =
          entry.phase === "reserved"
            ? options.config.reservationTimeout
            : options.config.idleTimeout;
        if (
          (entry.phase === "reserved" || entry.phase === "running") &&
          Date.now() - entry.touched >= limit
        )
          await stop(entry);
      }
    },
    shutdown: async () => {
      closing = true;
      const results = await Promise.all([...held.values()].map(stop));
      if (results.some((result) => result.status !== 200))
        return jarl.err(new Q.QemuFailed("some guests could not be stopped"));
      return jarl.ok(undefined);
    },
  };
};
export type Guests = ReturnType<typeof create>;
