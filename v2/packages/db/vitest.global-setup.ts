import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

// The lane needs Docker: a database test that skipped would pass without testing anything.
let container: StartedPostgreSqlContainer | undefined;

export const setup = async (project: TestProject) => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  project.provide("postgresUrl", container.getConnectionUri());
};

export const teardown = async () => {
  await container?.stop();
};

declare module "vitest" {
  export interface ProvidedContext {
    postgresUrl: string;
  }
}
