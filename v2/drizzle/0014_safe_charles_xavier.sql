ALTER TABLE "test_results" ADD COLUMN "model" text DEFAULT 'grok-4.6' NOT NULL;--> statement-breakpoint
UPDATE "test_results" AS "result" SET "model" = "run"."model" FROM "test_runs" AS "run" WHERE "result"."run_id" = "run"."id";--> statement-breakpoint
ALTER TABLE "test_runs" DROP COLUMN "model";