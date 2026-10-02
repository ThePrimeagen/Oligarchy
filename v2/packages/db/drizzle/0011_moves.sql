CREATE TYPE "public"."move_kind" AS ENUM('move', 'refused');--> statement-breakpoint
CREATE TABLE "moves" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "moves_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"kind" "move_kind" NOT NULL,
	"step" integer,
	"name" text,
	"reason" text,
	"arguments" jsonb,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moves_kind_check" CHECK (("moves"."kind" = 'move') = ("moves"."step" IS NOT NULL AND "moves"."name" IS NOT NULL AND "moves"."reason" IS NOT NULL AND "moves"."arguments" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moves_job_id_idx" ON "moves" USING btree ("job_id");