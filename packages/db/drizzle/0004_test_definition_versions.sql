DROP INDEX "test_definitions_name_idx";--> statement-breakpoint
CREATE INDEX "test_definitions_name_idx" ON "test_definitions" USING btree ("name");