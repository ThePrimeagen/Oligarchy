-- logs.session_id (uuid) becomes logs.location (text): a session UUID, 'server', or 'automation'.
-- Existing nulls were process-wide proxy lines; they become 'server'.
ALTER TABLE "logs" RENAME COLUMN "session_id" TO "location";--> statement-breakpoint
ALTER TABLE "logs" ALTER COLUMN "location" SET DATA TYPE text USING (
  CASE
    WHEN "location" IS NULL THEN 'server'
    ELSE "location"::text
  END
);--> statement-breakpoint
DROP INDEX IF EXISTS "logs_session_id_idx";--> statement-breakpoint
CREATE INDEX "logs_location_idx" ON "logs" USING btree ("location");
