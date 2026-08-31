CREATE TYPE "public"."test_result_status" AS ENUM('pending', 'running', 'passed', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."test_run_status" AS ENUM('pending', 'running', 'passed', 'failed', 'aborted', 'timed_out');--> statement-breakpoint
CREATE TABLE "test_definitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"description" text NOT NULL,
	"instruction" text NOT NULL,
	"proof" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"definition_id" bigint NOT NULL,
	"session_id" uuid,
	"status" "test_result_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "test_run_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_definition_id_test_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_definitions_name_version_idx" ON "test_definitions" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_run_definition_idx" ON "test_results" USING btree ("run_id","definition_id");