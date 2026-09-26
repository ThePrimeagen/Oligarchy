import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import * as Errors from "../src/errors.ts";

describe("automation-server errors", () => {
  it("JobNotFound fills its one message (happy)", () => {
    const error = Errors.JobNotFound.make({
      jobId: "job-1",
      url: "http://10.0.0.9:4000",
      cause: new Error("404"),
    });
    expect(error.message).toBe(`Job had "running" status but 404'd.`);
  });

  it("JobNotFound refuses any other message (unhappy)", () => {
    expect(() =>
      Schema.decodeUnknownSync(Errors.JobNotFound)({
        _tag: "JobNotFound",
        message: "gone",
        jobId: "job-1",
        url: "http://10.0.0.9:4000",
        cause: null,
      }),
    ).toThrow();
  });
});
