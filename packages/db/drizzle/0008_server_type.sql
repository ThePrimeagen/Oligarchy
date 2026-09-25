CREATE TYPE "public"."server_type" AS ENUM('qemu');--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "type" "server_type" DEFAULT 'qemu' NOT NULL;