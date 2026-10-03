ALTER TABLE "logs" ADD COLUMN "job_id" uuid;--> statement-breakpoint
CREATE INDEX "logs_job_id_idx" ON "logs" USING btree ("job_id");