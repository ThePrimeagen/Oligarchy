ALTER TABLE "servers" ADD COLUMN "stats" jsonb;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "generation" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "heartbeat_at" timestamp with time zone;