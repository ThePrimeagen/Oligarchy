CREATE TABLE "post_run_diagnosis" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"error_type" text NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_run_error_types" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_error_type_post_run_error_types_key_fk" FOREIGN KEY ("error_type") REFERENCES "public"."post_run_error_types"("key") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "post_run_diagnosis_error_type_idx" ON "post_run_diagnosis" USING btree ("error_type");