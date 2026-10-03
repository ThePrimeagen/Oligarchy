import * as App from "@oligarchy/app";
import * as Env from "@oligarchy/env";
import * as Testing from "@oligarchy/drive-harness/testing";
import * as FakeHttp from "@oligarchy/http/testing";
import * as Logger from "@oligarchy/logger/testing";
import * as jarl from "jarl";
import { beforeEach, expect, it, vi } from "vitest";
import * as Application from "../src/application.ts";
import { environment } from "../src/environment.ts";
import config from "../../../oligarchy.json";

beforeEach(() => vi.useFakeTimers());

it.each(["done", "timed_out", "failed"] as const)(
  "the application reports %s and finishes its lifecycle",
  async (outcome) => {
    const env = jarl.unwrap(
      await Env.create(
        environment,
        Env.fakeIo({
          argv: ["--job-id", Testing.JOB, "--server-url", Testing.SERVER_URL],
          env: {
            DATABASE_URL: "postgres://unused/test",
            OLIGARCHY_TOKEN: "test",
            OPENROUTER_API_KEY: "test",
          },
          files: { [Env.CONFIG_PATH]: JSON.stringify(config) },
        }),
      ),
    );
    const world = Testing.world({
      ...(outcome === "failed" ? { guest: { start: FakeHttp.status(500, "failed") } } : {}),
      turns: [
        () => {
          if (outcome === "timed_out") {
            vi.advanceTimersByTime(env.config.driver.runCeiling + 1);
            return jarl.ok({ content: "thinking", toolCalls: [] });
          }
          return Testing.said("Done", {});
        },
      ],
    });
    const services = { ...world.services, logger: Logger.logger().logger };
    const timedOut = vi.fn();
    const app = new App.App(env).main(Application.main({ timedOut }));
    const exited = vi.fn();
    const closed = vi.fn();
    app.onExit(closed);
    await app.run(services, () => undefined, {
      onSignal: () => () => undefined,
      stderr: () => undefined,
      exit: exited,
    });
    expect(timedOut).toHaveBeenCalledTimes(outcome === "timed_out" ? 1 : 0);
    expect(exited).toHaveBeenCalledWith(outcome === "failed" ? 1 : 0);
    expect(closed).toHaveBeenCalledOnce();
  },
);
