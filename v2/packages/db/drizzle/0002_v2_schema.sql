CREATE SCHEMA "v2";
--> statement-breakpoint
CREATE TYPE "v2"."action_state" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "v2"."job_kind" AS ENUM('mint', 'test');--> statement-breakpoint
CREATE TYPE "v2"."job_status" AS ENUM('pending', 'running', 'needs_review', 'reviewing', 'succeeded', 'failed', 'errored', 'aborted');--> statement-breakpoint
CREATE TYPE "v2"."log_level" AS ENUM('info', 'warning', 'error', 'fatal');--> statement-breakpoint
CREATE TYPE "v2"."server_type" AS ENUM('qemu', 'automation-client');--> statement-breakpoint
CREATE TYPE "v2"."verdict" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "v2"."vm_status" AS ENUM('reserved', 'downloading', 'running', 'stopped');--> statement-breakpoint
CREATE TABLE "v2"."actions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"request" jsonb NOT NULL,
	"state" "v2"."action_state",
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "v2"."base_prompts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."base_prompts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."debug_logs" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."definitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"description" text NOT NULL,
	"instruction" text NOT NULL,
	"proof" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."diagnoses" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"verdict" "v2"."verdict" NOT NULL,
	"error_type" text,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnoses_verdict_error_type_check" CHECK (("v2"."diagnoses"."verdict" = 'passed') = ("v2"."diagnoses"."error_type" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "v2"."error_types" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."images" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"action_id" bigint PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."job_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."job_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"from_status" "v2"."job_status",
	"to_status" "v2"."job_status" NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "v2"."jobs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"definition_id" bigint NOT NULL,
	"kind" "v2"."job_kind" NOT NULL,
	"status" "v2"."job_status" DEFAULT 'pending' NOT NULL,
	"client" text,
	"report_status" "v2"."verdict",
	"report_reason" text,
	"previous_id" uuid,
	"reason" text,
	"server_url" text,
	"vm_status" "v2"."vm_status",
	"vm_started_at" timestamp with time zone,
	"vm_stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_report_check" CHECK ("v2"."jobs"."report_status" IS NOT NULL OR "v2"."jobs"."report_reason" IS NULL),
	CONSTRAINT "jobs_vm_check" CHECK (("v2"."jobs"."server_url" IS NULL) = ("v2"."jobs"."vm_status" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "v2"."logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid,
	"location" text NOT NULL,
	"level" "v2"."log_level" DEFAULT 'info' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."mints" (
	"iso" text NOT NULL,
	"server_url" text NOT NULL,
	"job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mints_iso_server_url_pk" PRIMARY KEY("iso","server_url")
);
--> statement-breakpoint
CREATE TABLE "v2"."process_stats" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "v2"."process_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"type" "v2"."server_type" NOT NULL,
	"jobs" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"cpu_percent" double precision NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso" text NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "v2"."servers" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"url" text PRIMARY KEY NOT NULL,
	"name" text,
	"type" "v2"."server_type" NOT NULL,
	"stats" jsonb,
	"generation" bigint DEFAULT 0 NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servers_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "v2"."actions" ADD CONSTRAINT "actions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."debug_logs" ADD CONSTRAINT "debug_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."diagnoses" ADD CONSTRAINT "diagnoses_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."diagnoses" ADD CONSTRAINT "diagnoses_error_type_error_types_key_fk" FOREIGN KEY ("error_type") REFERENCES "v2"."error_types"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "v2"."images" ADD CONSTRAINT "images_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "v2"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "v2"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."jobs" ADD CONSTRAINT "jobs_definition_id_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "v2"."definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."jobs" ADD CONSTRAINT "jobs_previous_id_jobs_id_fk" FOREIGN KEY ("previous_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v2"."mints" ADD CONSTRAINT "mints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "v2"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_job_id_idx" ON "v2"."actions" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "base_prompts_name_idx" ON "v2"."base_prompts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "definitions_name_idx" ON "v2"."definitions" USING btree ("name");--> statement-breakpoint
CREATE INDEX "diagnoses_error_type_idx" ON "v2"."diagnoses" USING btree ("error_type");--> statement-breakpoint
CREATE UNIQUE INDEX "images_id_idx" ON "v2"."images" USING btree ("id");--> statement-breakpoint
CREATE INDEX "job_events_job_id_idx" ON "v2"."job_events" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_previous_id_idx" ON "v2"."jobs" USING btree ("previous_id");--> statement-breakpoint
CREATE INDEX "jobs_status_queued_at_idx" ON "v2"."jobs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "jobs_run_id_idx" ON "v2"."jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "logs_job_id_idx" ON "v2"."logs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "logs_location_idx" ON "v2"."logs" USING btree ("location");--> statement-breakpoint
CREATE INDEX "mints_server_url_idx" ON "v2"."mints" USING btree ("server_url");--> statement-breakpoint
CREATE UNIQUE INDEX "mints_job_id_idx" ON "v2"."mints" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "process_stats_name_reported_at_idx" ON "v2"."process_stats" USING btree ("name","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_name_idx" ON "v2"."servers" USING btree ("name");