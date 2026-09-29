ALTER TABLE "test_runs" DROP CONSTRAINT "test_runs_session_id_sessions_id_fk";
--> statement-breakpoint
DROP INDEX "test_runs_session_id_idx";--> statement-breakpoint
ALTER TABLE "test_runs" DROP COLUMN "session_id";