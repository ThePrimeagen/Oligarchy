CREATE TYPE "public"."test_result_state" AS ENUM('passed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."test_suite_status" AS ENUM('running', 'passed', 'failed', 'aborted');--> statement-breakpoint
CREATE TABLE "test_definitions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_definitions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"instruction" text NOT NULL,
	"proof" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"suite_id" uuid NOT NULL,
	"definition_id" bigint NOT NULL,
	"session_id" uuid,
	"state" "test_result_state",
	"reason" text,
	"evidence_action_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_suites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "test_suite_status" DEFAULT 'running' NOT NULL,
	"reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_definition_id_test_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_evidence_action_id_actions_id_fk" FOREIGN KEY ("evidence_action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_definitions_slug_version_idx" ON "test_definitions" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "test_results_suite_id_idx" ON "test_results" USING btree ("suite_id");