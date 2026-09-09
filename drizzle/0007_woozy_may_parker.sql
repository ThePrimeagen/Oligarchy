CREATE TYPE "public"."automation_action" AS ENUM('drive', 'diagnose');--> statement-breakpoint
CREATE TYPE "public"."automation_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
CREATE TABLE "automation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"action" "automation_action" NOT NULL,
	"status" "automation_job_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "test_results" ADD COLUMN "linear_id" text;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_result_id_test_results_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."test_results"("result_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_result_action_idx" ON "automation_jobs" USING btree ("result_id","action");--> statement-breakpoint
CREATE INDEX "automation_jobs_status_created_at_idx" ON "automation_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_linear_id_idx" ON "test_results" USING btree ("linear_id");