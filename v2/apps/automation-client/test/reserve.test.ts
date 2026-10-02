import * as Fake from "@oligarchy/http/testing";
import * as FakeLogger from "@oligarchy/logger/testing";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Jobs from "../src/jobs.ts";
import * as QemuServer from "../src/qemu-server.ts";
import * as Reserve from "../src/reserve.ts";
import { ReserveFailed } from "../src/routes.ts";

const TOKEN = "oligarchy-token";
const QEMU_SERVER = "http://127.0.0.1:42069";
const JOB = "6f1c2c1e-0b7a-4d43-9f6e-2b8f3f0f9a11";
const OTHER = "0d9f4b1a-5c2e-4f7a-8b3d-1e6a9c2f4b70";
const HOST = "http://10.0.0.5:4000";
const ISO = "https://iso.omarchy.org/omarchy-4.0.4.iso";
const DRIVE = { jobId: JOB, action: "drive", resume: ISO } as const;
const DIAGNOSE = { jobId: OTHER, action: "diagnose" } as const;

// Whether promise has settled once everything already queued has run.
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

// A reply the test hands over when it chooses.
const later = () => {
  let answer: (response: Response) => void = () => {};
  const reply = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return { reply, answer };
};

// The qemu server answers each path from its own replies, in order.
const reserving = (options: {
  readonly maxJobs?: number;
  readonly reserve?: ReadonlyArray<Fake.Reply | Promise<Response>>;
  readonly relinquish?: ReadonlyArray<Fake.Reply | Promise<Response>>;
}) => {
  const left = {
    "/reserve": [...(options.reserve ?? [])],
    "/relinquish": [...(options.relinquish ?? [])],
  };
  const fake = Fake.http({
    replies: (asked) => {
      const path = new URL(asked.url).pathname;
      const reply = path === "/reserve" || path === "/relinquish" ? left[path].shift() : undefined;
      if (reply === undefined) {
        throw new Error(`fake qemu server: no reply for ${path}`);
      }
      return reply;
    },
  });
  const jobs = Jobs.create();
  const log = FakeLogger.logger();
  const qemuServer = QemuServer.create({ http: fake.http, url: QEMU_SERVER, token: { reveal: () => TOKEN } });
  const reservations = Reserve.create({
    maxJobs: options.maxJobs ?? 2,
    jobs,
    qemuServer,
    logger: log.logger,
  });
  const asked = () => fake.asked.map((one) => [new URL(one.url).pathname, one.body]);
  return { jobs, reservations, asked, said: log.said };
};

describe("an automation client's reserve", () => {
  it("a drive holds the job and a guest at the qemu server, a diagnose the job alone; aborted before a run takes it, a drive's guest is given back and only then is the job let go (happy)", async () => {
    const relinquished = later();
    const { jobs, reservations, asked } = reserving({
      reserve: [Fake.json({})],
      relinquish: [relinquished.reply],
    });

    const answers = [await reservations.reserve(DRIVE), await reservations.reserve(DIAGNOSE)];

    expect(answers).toEqual([jarl.ok("reserved"), jarl.ok("reserved")]);
    expect(jobs.count()).toBe(2);
    expect(asked()).toEqual([["/reserve", { job: JOB, resume: ISO }]]);
    expect(await jobs.abort({ jobId: OTHER })).toBe("stopped");
    const aborting = jobs.abort({ jobId: JOB });
    expect(await settled(aborting)).toBe(false);
    expect(asked()).toEqual([
      ["/reserve", { job: JOB, resume: ISO }],
      ["/relinquish", { job: JOB }],
    ]);
    relinquished.answer(Fake.json({}));
    expect(await aborting).toBe("stopped");
    expect(jobs.count()).toBe(0);
  });

  it("at --max-jobs is at-capacity: the qemu server is not asked and the job is not held (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({ maxJobs: 1 });
    jarl.unwrap(await reservations.reserve(DIAGNOSE));

    const full = await reservations.reserve(DRIVE);

    expect(full).toEqual(jarl.ok("at-capacity"));
    expect(asked()).toEqual([]);
    expect(jobs.count()).toBe(1);
    expect(await jobs.abort({ jobId: JOB })).toBe("not-held");
  });

  it("a reserve while another is in flight is at-capacity, and the next once it has answered is heard (unhappy)", async () => {
    const first = later();
    const { jobs, reservations, asked } = reserving({ reserve: [first.reply] });
    const inFlight = reservations.reserve(DRIVE);
    await settled(inFlight);

    const meanwhile = await reservations.reserve(DIAGNOSE);

    expect(meanwhile).toEqual(jarl.ok("at-capacity"));
    expect(await jobs.abort({ jobId: OTHER })).toBe("not-held");
    first.answer(Fake.json({}));
    expect(await inFlight).toEqual(jarl.ok("reserved"));
    expect(await reservations.reserve(DIAGNOSE)).toEqual(jarl.ok("reserved"));
    expect(asked()).toEqual([["/reserve", { job: JOB, resume: ISO }]]);
  });

  it("a job already held is AlreadyHeld: the qemu server is not asked and the first reservation stands (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({});
    jarl.unwrap(await reservations.reserve({ jobId: JOB, action: "diagnose" }));

    const again = await reservations.reserve(DRIVE);

    expect(jarl.error.is(again, Jobs.AlreadyHeld)).toBe(true);
    expect(asked()).toEqual([]);
    expect(jobs.count()).toBe(1);
  });

  it("once shutdown has begun a reserve is ShuttingDown, and the qemu server is not asked (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({});
    await jobs.shutdown();

    const late = await reservations.reserve(DRIVE);

    expect(jarl.error.is(late, Jobs.ShuttingDown)).toBe(true);
    expect(asked()).toEqual([]);
    expect(jobs.count()).toBe(0);
  });

  it("a qemu server at capacity, or with no setup disk for the ISO, is that refusal: the job is let go and nothing is given back (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({
      reserve: [
        Fake.json({ error: "at capacity" }, 503),
        Fake.json({ error: "setup needed" }, 409),
      ],
    });

    const full = await reservations.reserve(DRIVE);
    const unset = await reservations.reserve(DRIVE);

    expect(full).toEqual(jarl.ok("at-capacity"));
    expect(unset).toEqual(jarl.ok("setup-needed"));
    expect(jobs.count()).toBe(0);
    expect(asked().map(([path]) => path)).toEqual(["/reserve", "/reserve"]);
  });

  it("a qemu server that refused the reserve with a 4xx reserved nothing: ReserveFailed naming why, the job let go and nothing given back (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({
      reserve: [Fake.json({ error: `no qemu host ${HOST}` }, 400)],
    });

    const failed = await reservations.reserve(DRIVE);

    expect(jarl.error.is(failed, ReserveFailed)).toBe(true);
    expect(jarl.is_err(failed) && failed.error.message).toBe(
      `reserving a guest failed: POST ${QEMU_SERVER}/reserve: 400: {"error":"no qemu host ${HOST}"}`,
    );
    expect(jobs.count()).toBe(0);
    expect(asked().map(([path]) => path)).toEqual(["/reserve"]);
  });

  it("a reserve that failed any other way may have landed: ReserveFailed naming why, its guest given back and the job let go (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({
      reserve: [Fake.json({ error: "DATABASE FAILURE" }, 500)],
      relinquish: [Fake.json({})],
    });

    const failed = await reservations.reserve(DRIVE);

    expect(jarl.error.is(failed, ReserveFailed)).toBe(true);
    expect(jarl.is_err(failed) && failed.error.message).toBe(
      `reserving a guest failed: POST ${QEMU_SERVER}/reserve: 500: {"error":"DATABASE FAILURE"}`,
    );
    expect(asked()).toEqual([
      ["/reserve", { job: JOB, resume: ISO }],
      ["/relinquish", { job: JOB }],
    ]);
    expect(jobs.count()).toBe(0);
  });

  it("an abort while the qemu server is still reserving ends that call, gives the guest back, and answers once the job is let go (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({
      reserve: ["hang"],
      relinquish: [Fake.json({})],
    });
    const inFlight = reservations.reserve(DRIVE);
    await settled(inFlight);

    const aborted = await jobs.abort({ jobId: JOB });

    expect(aborted).toBe("stopped");
    const failed = await inFlight;
    expect(jarl.error.is(failed, ReserveFailed)).toBe(true);
    expect(jarl.is_err(failed) && failed.error.message).toBe(
      `reserving a guest failed: job ${JOB} aborted`,
    );
    expect(asked()).toEqual([
      ["/reserve", { job: JOB, resume: ISO }],
      ["/relinquish", { job: JOB }],
    ]);
    expect(jobs.count()).toBe(0);
  });

  it("a guest the qemu server will not take back is an error line under the job, and the job is still let go (unhappy)", async () => {
    const { jobs, reservations, said } = reserving({
      reserve: [Fake.json({})],
      relinquish: [Fake.json({ error: "server down" }, 502)],
    });
    jarl.unwrap(await reservations.reserve(DRIVE));

    const aborted = await jobs.abort({ jobId: JOB });

    expect(aborted).toBe("stopped");
    expect(jobs.count()).toBe(0);
    expect(
      said.map(({ level, text, report }) => ({ level, text, agentId: report.agentId })),
    ).toEqual([
      {
        level: "error",
        text: `relinquish failed: POST ${QEMU_SERVER}/relinquish: 502: {"error":"server down"}`,
        agentId: JOB,
      },
    ]);
  });

  it("a reservation a run has taken is the run's: an abort aborts the run's signal, gives nothing back, and waits on the run's release (unhappy)", async () => {
    const { jobs, reservations, asked } = reserving({ reserve: [Fake.json({})] });
    jarl.unwrap(await reservations.reserve(DRIVE));

    const taken = reservations.take(JOB);

    expect(taken?.action).toBe("drive");
    expect(reservations.take(JOB)).toBe(undefined);
    expect(reservations.take(OTHER)).toBe(undefined);
    const aborting = jobs.abort({ jobId: JOB });
    expect(taken?.signal.aborted).toBe(true);
    expect(await settled(aborting)).toBe(false);
    taken?.release();
    expect(await aborting).toBe("stopped");
    expect(asked().map(([path]) => path)).toEqual(["/reserve"]);
  });
});
