CREATE TYPE "public"."vm_state" AS ENUM('downloading', 'running', 'shutdown', 'stopped', 'panicked', 'crashed', 'server-error');--> statement-breakpoint
CREATE TABLE "vm_status" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vm_status_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"status" "vm_state" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vm_status_reason_check" CHECK (("vm_status"."status" IN ('crashed', 'server-error')) = ("vm_status"."reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "vm_status" ADD CONSTRAINT "vm_status_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vm_status_job_id_id_idx" ON "vm_status" USING btree ("job_id","id");