CREATE TYPE "public"."action_state" AS ENUM('completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('downloading', 'running', 'succeeded', 'failed', 'aborted');--> statement-breakpoint
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
CREATE TABLE "images" (
	"action_id" bigint PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL
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
ALTER TABLE "actions" ADD CONSTRAINT "actions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_agent_id_agent_runs_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_runs"("agent_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_session_id_idx" ON "actions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_runs_session_id_idx" ON "agent_runs" USING btree ("session_id");