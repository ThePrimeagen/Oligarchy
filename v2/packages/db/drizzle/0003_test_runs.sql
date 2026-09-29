ALTER TYPE "public"."test_result_status" RENAME TO "test_run_status";--> statement-breakpoint
ALTER TABLE "test_results" RENAME TO "test_runs";--> statement-breakpoint
ALTER TABLE "test_runs" RENAME CONSTRAINT "test_results_pkey" TO "test_runs_pkey";--> statement-breakpoint
ALTER TABLE "automation_jobs" RENAME COLUMN "result_id" TO "run_id";--> statement-breakpoint
ALTER TABLE "setup_requests" RENAME COLUMN "result_id" TO "run_id";--> statement-breakpoint
ALTER TABLE "test_runs" RENAME COLUMN "result_id" TO "id";--> statement-breakpoint
ALTER TABLE "automation_jobs" DROP CONSTRAINT "automation_jobs_result_id_test_results_result_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs" DROP CONSTRAINT "test_results_suite_id_test_suites_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs" DROP CONSTRAINT "test_results_definition_id_test_definitions_id_fk";
--> statement-breakpoint
ALTER TABLE "test_runs" DROP CONSTRAINT "test_results_session_id_sessions_id_fk";
--> statement-breakpoint
DROP INDEX "automation_jobs_result_action_idx";--> statement-breakpoint
DROP INDEX "setup_requests_result_id_idx";--> statement-breakpoint
DROP INDEX "test_results_suite_definition_idx";--> statement-breakpoint
DROP INDEX "test_results_session_id_idx";--> statement-breakpoint
DROP INDEX "test_results_linear_id_idx";--> statement-breakpoint
ALTER TABLE "automation_jobs" ADD CONSTRAINT "automation_jobs_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_suite_id_test_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."test_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_definition_id_test_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."test_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_jobs_run_action_idx" ON "automation_jobs" USING btree ("run_id","action");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_requests_run_id_idx" ON "setup_requests" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_runs_suite_definition_idx" ON "test_runs" USING btree ("suite_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_runs_session_id_idx" ON "test_runs" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_runs_linear_id_idx" ON "test_runs" USING btree ("linear_id");