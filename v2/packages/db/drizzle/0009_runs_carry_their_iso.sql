DROP INDEX "test_runs_suite_definition_idx";--> statement-breakpoint
ALTER TABLE "test_runs" ALTER COLUMN "suite_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "test_definitions" ADD COLUMN "resume" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "iso" text;--> statement-breakpoint
ALTER TABLE "test_runs" ADD COLUMN "server_url" text;--> statement-breakpoint
UPDATE "test_runs" SET "iso" = "test_suites"."iso", "server_url" = "test_suites"."server_url" FROM "test_suites" WHERE "test_suites"."id" = "test_runs"."suite_id";--> statement-breakpoint
ALTER TABLE "test_runs" ALTER COLUMN "iso" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "test_runs" ALTER COLUMN "server_url" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "test_runs_suite_id_idx" ON "test_runs" USING btree ("suite_id");