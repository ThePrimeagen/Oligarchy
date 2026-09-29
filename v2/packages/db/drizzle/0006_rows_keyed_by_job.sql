CREATE TABLE "job_servers" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_servers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_servers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "agent_servers" CASCADE;--> statement-breakpoint
DROP TABLE "session_servers" CASCADE;--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_agent_id_agent_runs_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "debug_logs" DROP CONSTRAINT "debug_logs_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" DROP CONSTRAINT "post_run_diagnosis_session_id_sessions_id_fk";
--> statement-breakpoint
DROP INDEX "actions_session_id_idx";--> statement-breakpoint
DROP INDEX "test_runs_linear_id_idx";--> statement-breakpoint
ALTER TABLE "debug_logs" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "job_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD COLUMN "job_id" uuid PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD COLUMN "job_id" uuid PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "job_servers" ADD CONSTRAINT "job_servers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD CONSTRAINT "debug_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_job_id_idx" ON "actions" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "test_runs" DROP COLUMN "linear_id";