ALTER TABLE "debug_logs" ADD COLUMN "sources" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "debug_logs" DROP COLUMN "serial";--> statement-breakpoint
ALTER TABLE "debug_logs" DROP COLUMN "proxy_logs";