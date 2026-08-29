ALTER TABLE "actions" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actions" DROP COLUMN "duration_ms";