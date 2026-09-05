CREATE TABLE "debug_logs" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"serial" text NOT NULL,
	"proxy_logs" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "debug_logs" ADD CONSTRAINT "debug_logs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;