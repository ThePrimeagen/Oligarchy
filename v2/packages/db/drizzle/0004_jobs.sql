ALTER TYPE "public"."automation_action" RENAME TO "job_action";--> statement-breakpoint
ALTER TYPE "public"."automation_job_status" RENAME TO "job_status";--> statement-breakpoint
ALTER TABLE "automation_jobs" RENAME TO "jobs";--> statement-breakpoint
ALTER TABLE "jobs" RENAME CONSTRAINT "automation_jobs_pkey" TO "jobs_pkey";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "automation_jobs_run_id_test_runs_id_fk";
--> statement-breakpoint
DROP INDEX "automation_jobs_run_action_idx";--> statement-breakpoint
DROP INDEX "automation_jobs_status_created_at_idx";--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_run_action_idx" ON "jobs" USING btree ("run_id","action");--> statement-breakpoint
CREATE INDEX "jobs_status_created_at_idx" ON "jobs" USING btree ("status","created_at");