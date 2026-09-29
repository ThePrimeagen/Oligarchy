DROP INDEX "setup_requests_run_id_idx";--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "setup_requests" ADD COLUMN "job_id" uuid;--> statement-breakpoint
CREATE INDEX "logs_run_id_idx" ON "logs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_requests_job_id_idx" ON "setup_requests" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "logs" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "setup_requests" DROP COLUMN "run_id";