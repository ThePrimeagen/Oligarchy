ALTER TYPE "public"."job_action" RENAME VALUE 'mint' TO 'setup';--> statement-breakpoint
UPDATE "test_definitions" SET "name" = 'setup' WHERE "name" = 'mint';