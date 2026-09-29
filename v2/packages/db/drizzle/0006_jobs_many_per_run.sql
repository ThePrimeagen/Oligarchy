DROP INDEX "jobs_run_action_idx";--> statement-breakpoint
CREATE INDEX "jobs_run_action_idx" ON "jobs" USING btree ("run_id","action");