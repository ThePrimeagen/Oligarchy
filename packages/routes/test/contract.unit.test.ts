import { describe, expect, it } from "vitest";
import { Cause, Exit, Schema } from "effect";
import * as Contract from "../src/contract.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const AGENT_ID = "OLI-61";

describe("ServerUrl", () => {
  it("accepts an http or https url with a host as a ServerUrl and refuses anything else", () => {
    const is = Schema.is(Contract.ServerUrl);
    expect(is("http://10.0.0.5:42069")).toBe(true);
    expect(is("https://qemu.example.com")).toBe(true);
    expect(is("https://qemu.example.com/")).toBe(true);
    expect(is("")).toBe(false);
    expect(is("qemu.example.com:42069")).toBe(false);
    expect(is("ftp://qemu.example.com")).toBe(false);
    expect(is("http://")).toBe(false);
    expect(is("not a url")).toBe(false);
  });

  it("names the url rule in the ServerUrl decode failure", () => {
    const exit = Schema.decodeUnknownExit(Contract.ServerUrl)("qemu.example.com:42069");
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toMatch(/url must be an http or https url/);
    }
  });
});

describe("SessionMode", () => {
  it("is fresh or resume and nothing else", () => {
    const is = Schema.is(Contract.SessionMode);
    expect(is("fresh")).toBe(true);
    expect(is("resume")).toBe(true);
    expect(is("mint")).toBe(false);
    expect(is("")).toBe(false);
  });
});

describe("mouse bodies", () => {
  const decodeClick = Schema.decodeUnknownSync(Contract.MouseClickBody);
  const click = { id: SESSION_ID, x: 0.5, y: 0.25, button: "left", agent: AGENT_ID };

  it("a click takes a button and the keys held around it", () => {
    expect(decodeClick({ ...click, button: "right", modifiers: ["shift", "super"] })).toMatchObject(
      { button: "right", modifiers: ["shift", "super"] },
    );
    expect(decodeClick(click)).not.toHaveProperty("modifiers");
  });

  it("refuses the wheel as a click button, an unknown modifier and an empty modifier list", () => {
    expect(() => decodeClick({ ...click, button: "wheel-up" })).toThrow();
    expect(() => decodeClick({ ...click, modifiers: ["meta"] })).toThrow();
    expect(() => decodeClick({ ...click, modifiers: [] })).toThrow();
  });

  it("a drag goes from one screen point to another and a scroll names its direction", () => {
    expect(
      Schema.decodeUnknownSync(Contract.MouseDragBody)({
        id: SESSION_ID,
        from: { x: 0.1, y: 0.2 },
        to: { x: 0.9, y: 0.8 },
        button: "left",
        agent: AGENT_ID,
      }),
    ).toMatchObject({ from: { x: 0.1, y: 0.2 }, to: { x: 0.9, y: 0.8 } });
    expect(
      Schema.decodeUnknownSync(Contract.MouseScrollBody)({
        id: SESSION_ID,
        x: 0.5,
        y: 0.5,
        direction: "left",
        ticks: 3,
        agent: AGENT_ID,
      }),
    ).toMatchObject({ direction: "left", ticks: 3 });
  });

  it("refuses a drag without an end point and a scroll that turns no known way", () => {
    expect(() =>
      Schema.decodeUnknownSync(Contract.MouseDragBody)({
        id: SESSION_ID,
        from: { x: 0.1, y: 0.2 },
        button: "left",
        agent: AGENT_ID,
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(Contract.MouseScrollBody)({
        id: SESSION_ID,
        x: 0.5,
        y: 0.5,
        direction: "sideways",
        ticks: 3,
        agent: AGENT_ID,
      }),
    ).toThrow();
  });
});

describe("automation bodies", () => {
  const decodeReserve = Schema.decodeUnknownSync(Contract.ReserveBody);

  it("a reserve names its action and may pin the server by the url the fleet knows", () => {
    expect(decodeReserve({ ticket: AGENT_ID, action: "diagnose" })).toEqual(
      Contract.ReserveBody.make({ ticket: AGENT_ID, action: "diagnose" }),
    );
    expect(
      decodeReserve({ ticket: AGENT_ID, action: "mint", server: "http://10.0.0.5:42069" }),
    ).toMatchObject({ action: "mint", server: "http://10.0.0.5:42069" });
  });

  it("refuses an action outside drive, diagnose and mint, and a server that is not a url", () => {
    expect(() => decodeReserve({ ticket: AGENT_ID, action: "resume" })).toThrow();
    expect(() =>
      decodeReserve({ ticket: AGENT_ID, action: "mint", server: "10.0.0.5:42069" }),
    ).toThrow();
  });

  it("a stop may carry how the session ended and refuses a status a driver cannot set", () => {
    const decodeStop = Schema.decodeUnknownSync(Contract.StopBody);
    expect(decodeStop({ id: SESSION_ID, agent: AGENT_ID, status: "succeeded" })).toMatchObject({
      status: "succeeded",
    });
    expect(() => decodeStop({ id: SESSION_ID, agent: AGENT_ID, status: "timed_out" })).toThrow();
  });
});
