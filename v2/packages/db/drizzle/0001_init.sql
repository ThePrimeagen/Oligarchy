CREATE TYPE "public"."action_state" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."automation_action" AS ENUM('drive', 'diagnose', 'mint');--> statement-breakpoint
CREATE TYPE "public"."automation_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'aborted', 'timed_out', 'completed', 'errored');--> statement-breakpoint
CREATE TYPE "public"."diagnosis_verdict" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warning', 'error', 'fatal');--> statement-breakpoint
CREATE TYPE "public"."server_type" AS ENUM('qemu', 'automation-client');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('downloading', 'running', 'succeeded', 'failed', 'aborted', 'timed_out', 'completed', 'errored');--> statement-breakpoint
CREATE TYPE "public"."test_result_status" AS ENUM('pending', 'running', 'passed', 'failed', 'aborted', 'timed_out', 'completed', 'errored');--> statement-breakpoint
CREATE TYPE "public"."test_run_status" AS ENUM('pending', 'running', 'passed', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
CREATE TABLE "actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"session_id" uuid NOT NULL,
	"agent_id" text,
	"request" jsonb NOT NULL,
	"state" "action_state",
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_servers" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"action" "automation_action" NOT NULL,
	"status" "automation_job_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"server_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "debug_logs" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"action_id" bigint PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"location" text,
	"agent_id" text,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_run_diagnosis" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"verdict" "diagnosis_verdict" NOT NULL,
	"error_type" text,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_run_diagnosis_verdict_error_type_check" CHECK (("post_run_diagnosis"."verdict" = 'passed') = ("post_run_diagnosis"."error_type" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "post_run_error_types" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_stats" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "process_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"type" "server_type" NOT NULL,
	"jobs" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"cpu_percent" double precision NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"url" text PRIMARY KEY NOT NULL,
	"name" text,
	"type" "server_type" DEFAULT 'qemu' NOT NULL,
	"stats" jsonb,
	"generation" bigint DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "session_servers" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"status" "session_status" DEFAULT 'running' NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "setup_requests" (
	"iso" text NOT NULL,
	"server_url" text NOT NULL,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_requests_iso_server_url_pk" PRIMARY KEY("iso","server_url")
);
--> statement-breakpoint
CREATE TABLE "test_base_prompts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_base_prompts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_definitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instruction" text NOT NULL,
	"proof" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"result_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"definition_id" bigint NOT NULL,
	"session_id" uuid,
	"model" text,
	"linear_id" text,
	"status" "test_result_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"iso" text NOT NULL,
	"server_url" text NOT NULL,
	"status" "test_run_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_agent_id_agent_runs_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_runs"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_result_id_test_results_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."test_results"("result_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debug_logs" ADD CONSTRAINT "debug_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_error_type_post_run_error_types_key_fk" FOREIGN KEY ("error_type") REFERENCES "public"."post_run_error_types"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session_servers" ADD CONSTRAINT "session_servers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_definition_id_test_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_session_id_idx" ON "actions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_result_action_idx" ON "automation_jobs" USING btree ("result_id","action");--> statement-breakpoint
CREATE INDEX "automation_jobs_status_created_at_idx" ON "automation_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "images_id_idx" ON "images" USING btree ("id");--> statement-breakpoint
CREATE INDEX "logs_location_idx" ON "logs" USING btree ("location");--> statement-breakpoint
CREATE INDEX "post_run_diagnosis_error_type_idx" ON "post_run_diagnosis" USING btree ("error_type");--> statement-breakpoint
CREATE INDEX "process_stats_name_reported_at_idx" ON "process_stats" USING btree ("name","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_name_idx" ON "servers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "setup_requests_server_url_idx" ON "setup_requests" USING btree ("server_url");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_requests_result_id_idx" ON "setup_requests" USING btree ("result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_base_prompts_name_idx" ON "test_base_prompts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "test_definitions_name_idx" ON "test_definitions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_run_definition_idx" ON "test_results" USING btree ("run_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_session_id_idx" ON "test_results" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_linear_id_idx" ON "test_results" USING btree ("linear_id");