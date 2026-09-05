CREATE TYPE "public"."log_level" AS ENUM('info', 'warning', 'error', 'fatal');--> statement-breakpoint
ALTER TABLE "logs" ADD COLUMN "level" "log_level" DEFAULT 'info' NOT NULL;