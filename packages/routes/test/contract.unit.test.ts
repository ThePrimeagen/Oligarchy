import { describe, expect, it } from "vitest";
import { Cause, Exit, Schema } from "effect";
import * as Contract from "../src/contract.ts";

const SESSION_ID = "1baaad43-674b-4bdb-88d7-3f18fce50aba";
const AGENT_ID = "OLI-61";

// The vocabularies a body carries live in @oligarchy/shared/domain, where their own tests are;
// here, one case each proving the body still refuses a bad value with the vocabulary's message.
describe("bodies carrying shared vocabularies", () => {
  it("a server body refuses a url that is not http or https, naming the rule", () => {
    const exit = Schema.decodeUnknownExit(Contract.ServerBody)({ url: "qemu.example.com:42069" });
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toMatch(/url must be an http or https url/);
    }
    expect(Schema.decodeUnknownSync(Contract.ServerBody)({ url: "http://10.0.0.5:42069" })).toEqual(
      Contract.ServerBody.make({ url: "http://10.0.0.5:42069" }),
    );
  });

  it("a start body refuses a mode other than fresh or resume", () => {
    const decodeStart = Schema.decodeUnknownSync(Contract.StartBody);
    const start = { iso: "/isos/omarchy.iso", agent: AGENT_ID };
    expect(decodeStart({ ...start, mode: "resume" })).toMatchObject({ mode: "resume" });
    expect(decodeStart(start)).not.toHaveProperty("mode");
    expect(() => decodeStart({ ...start, mode: "mint" })).toThrow();
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
