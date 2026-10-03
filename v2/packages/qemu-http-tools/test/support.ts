import { readFileSync } from "node:fs";
import * as Env from "@oligarchy/env";
import * as Fake from "@oligarchy/http/testing";
import * as jarl from "jarl";
import * as QemuHttpTools from "../src/main.ts";

export const JOB = "job-7f3a";
export const TOKEN = "oligarchy-s3cret";
export const BASE_URL = "https://proxy.example";
const DEFAULT_TIMEOUT_MS = 5;

export const BEARER = { authorization: `Bearer ${TOKEN}` };
export const POSTED = { ...BEARER, "content-type": "application/json" };

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
export const SERIAL = "[    0.000000] Linux version 6.12\nomarchy login: ";

export const OK = Fake.json({ ok: "true" });
export const png = (): Response => new Response(PNG, { headers: { "Content-Type": "image/png" } });
export const serial = (): Response =>
  new Response(SERIAL, { headers: { "Content-Type": "text/plain" } });

export const url = (path: string): string => `${BASE_URL}/${path}`;

// A POST as the fake proxy records it: the job beside the call's own fields.
export const posted = (path: string, fields: Record<string, unknown> = {}): Fake.Asked => ({
  url: url(path),
  method: "POST",
  headers: POSTED,
  body: { job: JOB, ...fields },
});

export const got = (path: string): Fake.Asked => ({
  url: `${url(path)}?job=${JOB}`,
  method: "GET",
  headers: BEARER,
  body: undefined,
});

const CONFIG = readFileSync(Env.CONFIG_PATH, "utf8");

const token = async () =>
  jarl.unwrap(
    await Env.create(
      Env.cli({ name: "qemu-http-tools-test", description: "" }).needs("oligarchyToken").done(),
      Env.fakeIo({ env: { OLIGARCHY_TOKEN: TOKEN }, files: { [Env.CONFIG_PATH]: CONFIG } }),
    ),
  ).vars.oligarchyToken;

// What oligarchy.json's driver.guest names, handed in as the driver hands them.
export const START_TIMEOUT_MS = 90_000;
export const SAVE_TIMEOUT_MS = 30_000;
export const SEND_KEYS_TIMEOUT_MS = 20_000;

// JOB's tools over a fake proxy: one reply for every request, or one per request in order.
export const tools = async (
  replies: Fake.Reply | ReadonlyArray<Fake.Reply>,
  options: { readonly signal?: AbortSignal } = {},
) => {
  const fake = Fake.http({ replies, timeoutMs: DEFAULT_TIMEOUT_MS });
  const qemu = QemuHttpTools.create(
    { http: fake.http },
    options.signal ?? new AbortController().signal,
    {
      job: JOB,
      baseUrl: BASE_URL,
      token: await token(),
      startTimeoutMs: START_TIMEOUT_MS,
      saveTimeoutMs: SAVE_TIMEOUT_MS,
      sendKeysTimeoutMs: SEND_KEYS_TIMEOUT_MS,
    },
  );
  return { qemu, asked: fake.asked };
};
