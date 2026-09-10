ALTER TYPE "public"."server_type" ADD VALUE 'automation';--> statement-breakpoint
DROP INDEX "automation_jobs_result_action_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_result_action_idx" ON "automation_jobs" USING btree ("result_id","action") WHERE "automation_jobs"."status" in ('pending', 'running');--> statement-breakpoint
UPDATE "logs" SET "location" = 'automation-server' WHERE "location" = 'automation';
