CREATE TYPE "public"."action_state" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warning', 'error', 'fatal');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('downloading', 'running', 'succeeded', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."test_result_status" AS ENUM('pending', 'running', 'passed', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
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
	"session_id" uuid,
	"agent_id" text,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"text" text NOT NULL,
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
	"model" text DEFAULT 'grok-4.6' NOT NULL,
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
ALTER TABLE "debug_logs" ADD CONSTRAINT "debug_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_definition_id_test_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_session_id_idx" ON "actions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "images_id_idx" ON "images" USING btree ("id");--> statement-breakpoint
CREATE INDEX "logs_session_id_idx" ON "logs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_base_prompts_name_idx" ON "test_base_prompts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "test_definitions_name_idx" ON "test_definitions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_run_definition_idx" ON "test_results" USING btree ("run_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_session_id_idx" ON "test_results" USING btree ("session_id");