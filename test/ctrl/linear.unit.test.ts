import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Layer, Redacted } from "effect";
import { HttpClientError, type HttpClientRequest } from "effect/unstable/http";
import * as Linear from "../../src/ctrl/linear.ts";
import * as Render from "../../src/observability/render.ts";
import * as Errors from "../../src/shared/errors.ts";
import * as FakeHttp from "../support/fake-http.ts";

const TOKEN = "linear-token-s3ntinel";

const experiment = {
  id: "11111111-1111-4111-8111-111111111111",
  iso: "https://example.com/omarchy.iso",
  serverUrl: "https://qemu.example.com",
  version: "1.2.3",
  tests: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      definitionId: 1,
      name: "Install Omarchy",
      description: "Install the operating system",
      instruction: "Complete the installer",
      proof: "The desktop is visible",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      definitionId: 2,
      name: "Open a terminal",
      description: "Verify the terminal starts",
      instruction: "Launch the terminal",
      proof: "A terminal window is visible",
    },
  ],
};

const firstTest = experiment.tests[0];

type GraphQl = { readonly query: string; readonly variables?: Record<string, unknown> };

const decoder = new TextDecoder();

const graphql = (request: HttpClientRequest.HttpClientRequest): GraphQl => {
  const body = request.body;
  if (body._tag !== "Uint8Array") {
    throw new Error("expected a JSON request body");
  }
  return JSON.parse(decoder.decode(body.body));
};

const labelId = (name: string): string => `label-${name}`;

const issueResponse = (identifier: string): Response =>
  FakeHttp.json({
    data: {
      issueCreate: {
        success: true,
        issue: {
          id: `issue-${identifier}`,
          identifier,
          url: `https://linear.app/issue/${identifier}`,
        },
      },
    },
  });

const describeResponse = (): Response =>
  FakeHttp.json({ data: { issueUpdate: { success: true } } });

const teamResponse = (): Response =>
  FakeHttp.json({ data: { teams: { nodes: [{ id: "team-id" }] } } });

const existingLabel = (body: GraphQl): Response =>
  FakeHttp.json({
    data: { issueLabels: { nodes: [{ id: labelId(String(body.variables?.name)) }] } },
  });

const userResponse = (): Response =>
  FakeHttp.json({ data: { users: { nodes: [{ id: "user-id" }] } } });

// The scripted Linear used by the happy path: every query answered as v1's tests answered it.
const happyLinear = (body: GraphQl): Response => {
  if (body.query.includes("teams(")) {
    return teamResponse();
  }
  if (body.query.includes("issueLabels")) {
    return existingLabel(body);
  }
  if (body.query.includes("users(filter")) {
    return userResponse();
  }
  if (body.query.includes("issueUpdate")) {
    return describeResponse();
  }
  return issueResponse("OLI-42");
};

const withHttp = (respond: (body: GraphQl) => Response) =>
  FakeHttp.recordRequests((request) => respond(graphql(request)));

const linear = (token = TOKEN) => Linear.Linear.layer(Redacted.make(token));

// The ticket body is opaque to the Linear client: any text stands in for the rendered prompt.
const describedAs = (ticket: string): string =>
  `${ticket}: ${firstTest.name} on ${experiment.iso} at ${experiment.serverUrl}; ${firstTest.instruction}`;

// The whole ticket flow as `test new` runs it for one definition.
const createTicket = Effect.gen(function* () {
  const client = yield* Linear.Linear;
  const teamId = yield* client.teamId;
  const labelIds = yield* client.labelIds(teamId, experiment.version);
  const assigneeId = yield* client.assigneeId;
  const ticket = yield* client.createIssue({
    teamId,
    title: `Omarchy: ${firstTest.name}`,
    labelIds,
    assigneeId,
  });
  yield* client.describeIssue(ticket, describedAs(ticket.identifier));
  return ticket;
});

const failureOf = <A, R>(self: Effect.Effect<A, Errors.LinearError, R>) =>
  Effect.flip(self).pipe(Effect.provide(linear()));

describe("Linear happy path", () => {
  it.effect(
    "resolves the Oligarchy team by name, existing labels, and creates an issue for one definition",
    () =>
      Effect.gen(function* () {
        const http = withHttp(happyLinear);
        const ticket = yield* createTicket.pipe(
          Effect.provide(linear().pipe(Layer.provide(http.layer))),
        );

        expect(ticket).toEqual({
          id: "issue-OLI-42",
          identifier: "OLI-42",
          url: "https://linear.app/issue/OLI-42",
        });
        expect(http.requests).toHaveLength(6);
        const bodies: ReadonlyArray<GraphQl> = http.requests.map((request) =>
          JSON.parse(request.body),
        );
        for (const request of http.requests) {
          expect(request.method).toBe("POST");
          expect(request.url).toBe(Linear.LINEAR_API_URL);
          expect(request.headers.authorization).toBe(TOKEN);
          expect(request.headers["content-type"]).toBe("application/json");
        }
        expect(bodies[0]?.query).toMatch(/teams\(filter: \{ name: \{ eq: \$name \} \}, first: 1\)/);
        expect(bodies[0]?.variables).toEqual({ name: "Oligarchy" });
        expect(bodies[1]?.query).toMatch(/\$teamId: ID!/);
        expect(bodies[1]?.variables).toEqual({ name: "agent test", teamId: "team-id" });
        expect(bodies[2]?.variables).toEqual({ name: experiment.version, teamId: "team-id" });
        expect(bodies[3]?.variables).toEqual({ email: "prime@terminal.shop" });
        expect(bodies[4]?.variables).toEqual({
          input: {
            teamId: "team-id",
            title: `Omarchy: ${firstTest.name}`,
            labelIds: [labelId("agent test"), labelId(experiment.version)],
            assigneeId: "user-id",
          },
        });
        expect(bodies[5]?.query).toMatch(/issueUpdate\(id: \$id/);
        expect(bodies[5]?.variables).toEqual({
          id: "issue-OLI-42",
          input: {
            description: describedAs("OLI-42"),
          },
        });
      }),
  );

  it.effect("creates missing labels before creating the issue", () =>
    Effect.gen(function* () {
      const created: Array<string> = [];
      const http = withHttp((body) => {
        if (body.query.includes("teams(")) {
          return teamResponse();
        }
        if (body.query.includes("issueLabels")) {
          return FakeHttp.json({ data: { issueLabels: { nodes: [] } } });
        }
        if (body.query.includes("issueLabelCreate")) {
          const input = body.variables?.input;
          const name =
            typeof input === "object" && input !== null && "name" in input
              ? String(input.name)
              : "";
          created.push(name);
          return FakeHttp.json({
            data: { issueLabelCreate: { success: true, issueLabel: { id: labelId(name) } } },
          });
        }
        if (body.query.includes("users(filter")) {
          return userResponse();
        }
        if (body.query.includes("issueUpdate")) {
          return describeResponse();
        }
        return issueResponse("OLI-42");
      });
      const ticket = yield* createTicket.pipe(
        Effect.provide(linear().pipe(Layer.provide(http.layer))),
      );
      expect(created).toEqual(["agent test", experiment.version]);
      expect(ticket.identifier).toBe("OLI-42");
      const bodies: ReadonlyArray<GraphQl> = http.requests.map((request) =>
        JSON.parse(request.body),
      );
      expect(bodies[2]?.variables).toEqual({ input: { name: "agent test", teamId: "team-id" } });
    }),
  );

  it.effect("listBacklog pages with first: 100 until hasNextPage is false", () =>
    Effect.gen(function* () {
      const pages = [
        {
          nodes: [
            { id: "i1", identifier: "OLI-1", title: "one", url: "https://linear.app/issue/OLI-1" },
          ],
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        },
        {
          nodes: [
            { id: "i2", identifier: "OLI-2", title: "two", url: "https://linear.app/issue/OLI-2" },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      ];
      let page = 0;
      const http = withHttp(() => {
        const current = pages[page];
        page++;
        return FakeHttp.json({ data: { issues: current } });
      });
      const tickets = yield* Effect.flatMap(Linear.Linear, (client) => client.listBacklog).pipe(
        Effect.provide(linear().pipe(Layer.provide(http.layer))),
      );
      expect(tickets).toEqual([...(pages[0]?.nodes ?? []), ...(pages[1]?.nodes ?? [])]);
      const bodies: ReadonlyArray<GraphQl> = http.requests.map((request) =>
        JSON.parse(request.body),
      );
      expect(bodies).toHaveLength(2);
      expect(bodies[0]?.query).toMatch(/issues\(first: 100, after: \$after, filter: \$filter\)/);
      expect(bodies[0]?.variables).toEqual({
        filter: { team: { name: { eq: "Oligarchy" } }, state: { type: { eq: "backlog" } } },
      });
      expect(bodies[1]?.variables).toEqual({
        filter: { team: { name: { eq: "Oligarchy" } }, state: { type: { eq: "backlog" } } },
        after: "cursor-1",
      });
    }),
  );
});

describe("Linear unhappy path", () => {
  it.effect("reports an HTTP failure with the status and the body", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => new Response("unauthorized", { status: 401 }));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error).toMatchObject({
        _tag: "LinearError",
        operation: "teamId",
        status: 401,
        message: "linear: request failed (401): unauthorized",
      });
    }),
  );

  it.effect("reports an HTTP failure with an empty body without a trailing colon", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => new Response(null, { status: 500 }));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: request failed (500)");
    }),
  );

  it.effect("reports a GraphQL failure, joining the messages", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({ errors: [{ message: "API key has no access" }, { message: "and more" }] }),
      );
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: API key has no access; and more");
    }),
  );

  it.effect(
    "rejects a token that cannot see a team named Oligarchy, even when it sees others",
    () =>
      Effect.gen(function* () {
        const http = withHttp((body) =>
          FakeHttp.json({
            data: {
              teams: { nodes: body.variables?.name === "Oligarchy" ? [] : [{ id: "some-other" }] },
            },
          }),
        );
        const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
        expect(error.message).toBe("linear: no team named Oligarchy");
        expect(http.requests).toHaveLength(1);
        const body: GraphQl = JSON.parse(http.requests[0]?.body ?? "");
        expect(body.variables).toEqual({ name: "Oligarchy" });
      }),
  );

  it.effect("rejects when prime@terminal.shop is not a workspace user", () =>
    Effect.gen(function* () {
      const http = withHttp((body) => {
        if (body.query.includes("teams(")) {
          return teamResponse();
        }
        if (body.query.includes("issueLabels")) {
          return existingLabel(body);
        }
        return FakeHttp.json({ data: { users: { nodes: [] } } });
      });
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: no user prime@terminal.shop");
    }),
  );

  it.effect("reports a label creation failure", () =>
    Effect.gen(function* () {
      const http = withHttp((body) => {
        if (body.query.includes("teams(")) {
          return teamResponse();
        }
        if (body.query.includes("issueLabels")) {
          return FakeHttp.json({ data: { issueLabels: { nodes: [] } } });
        }
        return FakeHttp.json({ data: { issueLabelCreate: { success: false, issueLabel: null } } });
      });
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: label creation failed");
    }),
  );

  it.effect("reports an issue creation failure", () =>
    Effect.gen(function* () {
      const http = withHttp((body) => {
        if (body.query.includes("teams(")) {
          return teamResponse();
        }
        if (body.query.includes("issueLabels")) {
          return existingLabel(body);
        }
        if (body.query.includes("users(filter")) {
          return userResponse();
        }
        return FakeHttp.json({ data: { issueCreate: { success: false, issue: null } } });
      });
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: issue creation failed");
    }),
  );

  it.effect("reports a description failure by ticket", () =>
    Effect.gen(function* () {
      const http = withHttp((body) => {
        if (body.query.includes("issueUpdate")) {
          return FakeHttp.json({ data: { issueUpdate: { success: false } } });
        }
        return happyLinear(body);
      });
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: describing OLI-42 failed");
    }),
  );

  it.effect("reports a body that is not JSON as an invalid response", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => new Response("<html>", { status: 200 }));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: invalid response");
    }),
  );

  it.effect("reports a JSON body without data as an invalid response", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => FakeHttp.json({}));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: invalid response");
    }),
  );

  it.effect("reports data of the wrong shape as an invalid response", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => FakeHttp.json({ data: { teams: "nope" } }));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      expect(error.message).toBe("linear: invalid response");
    }),
  );

  it.effect("listBacklog fails as an invalid response when a further page has no cursor", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() =>
        FakeHttp.json({
          data: { issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } },
        }),
      );
      const error = yield* failureOf(
        Effect.flatMap(Linear.Linear, (client) => client.listBacklog),
      ).pipe(Effect.provide(http.layer));
      expect(error).toMatchObject({
        operation: "listBacklog",
        message: "linear: invalid response",
      });
      expect(http.requests).toHaveLength(1);
    }),
  );

  it.effect("wraps a transport failure with its detail and names the operation", () =>
    Effect.gen(function* () {
      const http = FakeHttp.respondWith((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error("connect ECONNREFUSED 127.0.0.1:1"),
              description: "connect ECONNREFUSED 127.0.0.1:1",
            }),
          }),
        ),
      );
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http));
      expect(error.operation).toBe("teamId");
      expect(error.status).toBeUndefined();
      expect(error.message).toBe("linear: request failed");
      expect(Render.headline(error)).toBe(
        "linear: request failed: Transport: connect ECONNREFUSED 127.0.0.1:1 (POST https://api.linear.app/graphql)",
      );
    }),
  );

  it.effect("the token never appears in any error", () =>
    Effect.gen(function* () {
      const http = FakeHttp.recordRequests(() => new Response("unauthorized", { status: 401 }));
      const error = yield* failureOf(createTicket).pipe(Effect.provide(http.layer));
      const rendered = `${error.message}\n${Cause.pretty(Cause.fail(error))}\n${JSON.stringify(error)}`;
      expect(rendered).not.toContain(TOKEN);
    }),
  );
});
