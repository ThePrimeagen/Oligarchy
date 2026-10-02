import type * as App from "@oligarchy/app";
import * as Async from "@oligarchy/async";
import type * as Env from "@oligarchy/env";
import * as Http from "@oligarchy/http";
import * as Client from "@oligarchy/http/client";
import type * as Logger from "@oligarchy/logger";
import type { Handler, Requests } from "@oligarchy/qemu/routes";
import type { Routes as RunnerRoutes } from "@oligarchy/qemu-runner/routes";
import type * as Stores from "@oligarchy/stores";
import * as jarl from "jarl";

type Wants =
  | Http.Http
  | Logger.Logger
  | Stores.Servers.Servers
  | Stores.Tests.Tests
  | Stores.SetupRequests.SetupRequests;
export type Options = {
  readonly token: { reveal(): string };
  readonly url: string;
  readonly config: Pick<Env.Config, "qemuServer" | "driver" | "httpTimeout">;
};
const error = (message: string, status: number) => Response.json({ error: message }, { status });
export const create = (services: App.Needs<Wants>, options: Options) => {
  let closing = false;
  let reservation: Promise<unknown> = Promise.resolve();
  const flights = new Set<Promise<unknown>>();
  const cfg = options.config.qemuServer;
  const client = (url: string) =>
    Client.connect<RunnerRoutes>({ http: services.http, url, token: options.token });
  const convert = (response: Http.HttpResponse) => {
    const headers = new Headers();
    for (const key of [
      "content-type",
      "cache-control",
      "x-image-url",
      "x-image-id",
      "retry-after",
    ]) {
      const value = response.headers.get(key);
      if (value !== null) headers.set(key, value);
    }
    const empty = [204, 205, 304].includes(response.status);
    if (empty) void response.close();
    return new Response(empty ? null : Http.body(response), { status: response.status, headers });
  };
  const release = async (url: string, job: string) => {
    const result = await client(url).request(
      "$post",
      "/relinquish",
      { json: { job } },
      { timeoutMs: cfg.releaseTimeout },
    );
    if (jarl.is_err(result)) return false;
    const response = jarl.value(result);
    await response.close();
    return response.status === 200 || response.status === 404;
  };
  const probe = async (url: string, signal: AbortSignal) => {
    const result = await client(url).request(
      "$get",
      "/stats",
      {},
      { signal, timeoutMs: cfg.probeTimeout },
    );
    if (jarl.is_err(result)) return undefined;
    const response = jarl.value(result);
    if (response.status !== 200) {
      await response.close();
      return undefined;
    }
    try {
      const data: unknown = await new Response(Http.body(response)).json();
      if (
        typeof data !== "object" ||
        data === null ||
        !("jobs" in data) ||
        !("available" in data) ||
        typeof data.jobs !== "number" ||
        !Number.isFinite(data.jobs) ||
        typeof data.available !== "number" ||
        !Number.isFinite(data.available)
      )
        return undefined;
      return { url, jobs: data.jobs, available: data.available };
    } catch {
      return undefined;
    }
  };
  const register = async (url: string, signal: AbortSignal) => {
    if ((await probe(url, signal)) === undefined)
      return error("runner did not answer its stats probe", 502);
    const added = await services.servers.addServer(url, "qemu");
    return jarl.is_err(added) ? error(added.error.message, 500) : Response.json({});
  };
  const askReserve = async (
    url: string,
    input: Requests["reserve"],
    signal: AbortSignal,
  ): Promise<Response> => {
    const result = await client(url).request(
      "$post",
      "/reserve",
      { json: input },
      { signal, timeoutMs: cfg.reserveTimeout },
    );
    if (jarl.is_err(result)) {
      const released = await release(url, input.job);
      return error(`${result.error.message}${released ? "" : "; runner cleanup unconfirmed"}`, 502);
    }
    const response = jarl.value(result);
    if (response.status !== 200) return convert(response);
    await response.close();
    const existing = await services.servers.serverForJob(input.job);
    if (jarl.is_err(existing)) {
      await release(url, input.job);
      return error(existing.error.message, 500);
    }
    if (jarl.value(existing) === undefined) {
      const written = await services.servers.routeJob(input.job, url);
      if (jarl.is_err(written)) {
        // The insert may have committed before its acknowledgement was lost.
        const read = await services.servers.serverForJob(input.job);
        if (jarl.is_err(read) || jarl.value(read) !== url) {
          await release(url, input.job);
          return error(written.error.message, 500);
        }
      }
    } else if (jarl.value(existing) !== url) {
      await release(url, input.job);
      return error("job is assigned to another runner", 409);
    }
    return Response.json({});
  };
  const reserve = async (input: Requests["reserve"], signal: AbortSignal) => {
    const assigned = await services.servers.serverForJob(input.job);
    if (jarl.is_err(assigned)) return error(assigned.error.message, 500);
    const existing = jarl.value(assigned);
    if (existing !== undefined) return askReserve(existing, input, signal);
    const machines = await services.servers.listServers("qemu");
    if (jarl.is_err(machines)) return error(machines.error.message, 500);
    const urls = jarl.value(machines);
    if (input.setupServer !== undefined) {
      if (!urls.includes(input.setupServer)) return error("setup runner unavailable", 503);
      return askReserve(input.setupServer, input, signal);
    }
    const probed = await Promise.all(urls.map((url) => probe(url, signal)));
    const candidates = probed
      .filter((runner) => runner !== undefined)
      .filter((runner) => runner.available > 0)
      .sort((a, b) => a.jobs - b.jobs);
    let missingSetup = false;
    for (const runner of candidates) {
      const url = runner.url;
      if (signal.aborted) return error("reservation aborted", 503);
      if (input.resume !== undefined) {
        const diskProbe = await client(url).request(
          "$get",
          "/setup-disks",
          { query: { iso: input.resume } },
          { signal, timeoutMs: cfg.probeTimeout },
        );
        if (jarl.is_err(diskProbe)) continue;
        const response = jarl.value(diskProbe);
        if (response.status !== 200) {
          await response.close();
          continue;
        }
        let data: unknown;
        try {
          data = await new Response(Http.body(response)).json();
        } catch {
          continue;
        }
        if (
          typeof data !== "object" ||
          data === null ||
          !("available" in data) ||
          typeof data.available !== "boolean"
        )
          continue;
        if (!data.available) {
          missingSetup = true;
          const setup = await services.tests.ensureSetup({
            iso: input.resume,
            serverUrl: options.url,
            setupServer: url,
          });
          if (jarl.is_err(setup))
            services.logger.error(`setup scheduling failed: ${setup.error.message}`, {
              location: "qemu-server",
              cause: setup.error,
            });
          continue;
        }
      }
      const answer = await askReserve(url, input, signal);
      if (answer.status === 503) {
        await answer.body?.cancel();
        continue;
      }
      return answer;
    }
    return error(missingSetup ? "setup needed" : "at capacity", missingSetup ? 409 : 503);
  };
  const forward: Handler = async (...request) => {
    const [operation, input, signal] = request;
    if (!("job" in input)) return error("missing job", 400);
    const found = await services.servers.serverForJob(input.job);
    if (jarl.is_err(found)) return error(found.error.message, 500);
    const url = jarl.value(found);
    if (url === undefined) return error("job not assigned", 404);
    const remote = client(url);
    let timeoutMs = options.config.httpTimeout;
    if (operation === "start") timeoutMs = options.config.driver.guest.startTimeout;
    else if (operation === "save") timeoutMs = options.config.driver.guest.saveTimeout;
    else if (operation === "follow") timeoutMs = cfg.followTimeout;
    else if (["abort", "stop", "relinquish"].includes(operation)) timeoutMs = cfg.releaseTimeout;
    const init = { signal, timeoutMs };
    const send = (): ReturnType<Http.Http["open"]> => {
      switch (operation) {
        case "image":
          return remote.request("$get", "/image", { query: input }, init);
        case "serial":
          return remote.request("$get", "/serial", { query: input }, init);
        case "follow":
          return remote.request("$get", "/follow", { query: input }, init);
        case "reserve":
          return remote.request("$post", "/reserve", { json: input }, init);
        case "start":
          return remote.request("$post", "/start", { json: input }, init);
        case "stop":
          return remote.request("$post", "/stop", { json: input }, init);
        case "save":
          return remote.request("$post", "/save", { json: input }, init);
        case "relinquish":
          return remote.request("$post", "/relinquish", { json: input }, init);
        case "abort":
          return remote.request("$post", "/abort", { json: input }, init);
        case "send-keys":
          return remote.request("$post", "/send-keys", { json: input }, init);
        case "intent/start":
          return remote.request("$post", "/intent/start", { json: input }, init);
        case "intent/end":
          return remote.request("$post", "/intent/end", { json: input }, init);
        case "mouse/move":
          return remote.request("$post", "/mouse/move", { json: input }, init);
        case "mouse/click":
          return remote.request("$post", "/mouse/click", { json: input }, init);
        case "mouse/double-click":
          return remote.request("$post", "/mouse/double-click", { json: input }, init);
        case "mouse/drag":
          return remote.request("$post", "/mouse/drag", { json: input }, init);
        case "mouse/scroll":
          return remote.request("$post", "/mouse/scroll", { json: input }, init);
        case "mouse/hold":
          return remote.request("$post", "/mouse/hold", { json: input }, init);
        case "mouse/release":
          return remote.request("$post", "/mouse/release", { json: input }, init);
        default:
          return Promise.resolve(
            jarl.err(
              new Http.HttpUnreachable(
                { method: "GET", url },
                new Error("invalid forwarding operation"),
              ),
            ),
          );
      }
    };
    const result = await send();
    return jarl.is_err(result) ? error(result.error.message, 502) : convert(jarl.value(result));
  };
  const abort = (input: Requests["abort"], signal: AbortSignal) => forward("abort", input, signal);
  const handle: Handler = async (...request) => {
    const [operation, input, signal] = request;
    if (closing) return error("shutting down", 503);
    if (operation === "reserve") {
      const previous = reservation;
      const work = (async () => {
        await previous;
        if (closing) return error("shutting down", 503);
        let settled: Promise<unknown> = Promise.resolve();
        const result = await Async.timeout(
          (inner) => {
            const running = jarl.exec(
              () => reserve(input, inner),
              (cause) => new Error(String(cause)),
            );
            settled = running;
            return running;
          },
          { ms: cfg.reserveTimeout, signal },
        );
        // Cleanup belongs to this placement attempt even if its request deadline elapsed.
        await settled;
        return jarl.is_err(result) ? error(result.error.message, 502) : jarl.value(result);
      })();
      reservation = work.catch(() => undefined);
      flights.add(work);
      try {
        return await work;
      } finally {
        flights.delete(work);
      }
    }
    if (operation === "stats") {
      const machines = await services.servers.listMachines();
      return jarl.is_err(machines)
        ? error(machines.error.message, 500)
        : Response.json(jarl.value(machines).filter((m) => m.type === "qemu"));
    }
    if (operation === "setup-disks") {
      const machines = await services.servers.listServers("qemu");
      if (jarl.is_err(machines)) return error(machines.error.message, 500);
      const results = await Promise.all(
        jarl.value(machines).map(async (url) => {
          const result = await client(url).request(
            "$get",
            "/setup-disks",
            { query: input },
            { signal, timeoutMs: cfg.probeTimeout },
          );
          if (jarl.is_err(result)) return { url, available: false, error: result.error.message };
          const response = jarl.value(result);
          try {
            const data: unknown = await new Response(Http.body(response)).json();
            if (
              typeof data !== "object" ||
              data === null ||
              !("available" in data) ||
              typeof data.available !== "boolean"
            )
              throw new Error("invalid disk response");
            return { url, status: response.status, available: data.available };
          } catch {
            return { url, available: false, error: "invalid runner response" };
          }
        }),
      );
      return Response.json(results);
    }
    const work = operation === "abort" ? abort(input, signal) : forward(...request);
    flights.add(work);
    try {
      return await work;
    } finally {
      flights.delete(work);
    }
  };
  return {
    handle,
    register,
    shutdown: async () => {
      closing = true;
      await Promise.all(flights);
    },
  };
};
export type Router = ReturnType<typeof create>;
