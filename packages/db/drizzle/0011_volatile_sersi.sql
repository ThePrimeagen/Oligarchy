ALTER TABLE "automation_jobs" ADD COLUMN "server_id" uuid;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_id_unique" UNIQUE("id");