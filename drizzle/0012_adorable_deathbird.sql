ALTER TABLE "servers" ADD COLUMN "jobs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "max_jobs" integer DEFAULT 1 NOT NULL;