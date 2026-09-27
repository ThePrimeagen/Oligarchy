import { inspect } from "node:util";
import * as jarl from "jarl";
import { describe, expect, it } from "vitest";
import * as Db from "../src/main.ts";
import { databaseUrl, poolErrors } from "./support.ts";

const PASSWORD = "pa55w0rd-sentinel";

describe("open", () => {
  it("refuses a url that cannot be parsed, and the password appears nowhere (unhappy)", async () => {
    const result = Db.open({
      url: await databaseUrl(`not a url ${PASSWORD}`),
      onPoolError: poolErrors().onPoolError,
    });
    if (!jarl.error.is(result, Db.DatabaseError)) {
      throw new Error("expected a DatabaseError");
    }
    expect(result.error.message).toBe("db: database url is not a valid url");
    const renderings = [
      String(result.error),
      JSON.stringify(result.error),
      inspect(result.error),
      result.error.stack ?? "",
    ];
    for (const rendered of renderings) {
      expect(rendered).not.toContain(PASSWORD);
    }
  });
});
