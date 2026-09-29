ALTER TYPE "public"."test_run_status" RENAME TO "test_suite_status";--> statement-breakpoint
ALTER TABLE "test_runs" RENAME TO "test_suites";--> statement-breakpoint
ALTER TABLE "test_suites" RENAME CONSTRAINT "test_runs_pkey" TO "test_suites_pkey";--> statement-breakpoint
ALTER TABLE "test_results" RENAME COLUMN "run_id" TO "suite_id";--> statement-breakpoint
ALTER TABLE "test_results" DROP CONSTRAINT "test_results_run_id_test_runs_id_fk";
--> statement-breakpoint
DROP INDEX "test_results_run_definition_idx";--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_results_suite_definition_idx" ON "test_results" USING btree ("suite_id","definition_id");