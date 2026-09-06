ALTER TABLE "test_runs" ADD COLUMN "model" text DEFAULT 'grok-4.6' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_session_id_idx" ON "test_results" USING btree ("session_id");