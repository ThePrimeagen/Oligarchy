CREATE TYPE "public"."diagnosis_verdict" AS ENUM('passed', 'failed');--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ALTER COLUMN "error_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD COLUMN "verdict" "diagnosis_verdict" NOT NULL;--> statement-breakpoint
ALTER TABLE "post_run_diagnosis" ADD CONSTRAINT "post_run_diagnosis_verdict_error_type_check" CHECK (("post_run_diagnosis"."verdict" = 'passed') = ("post_run_diagnosis"."error_type" IS NULL));