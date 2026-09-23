ALTER TYPE "public"."automation_job_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TYPE "public"."automation_job_status" ADD VALUE 'errored';--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TYPE "public"."session_status" ADD VALUE 'errored';--> statement-breakpoint
ALTER TYPE "public"."test_result_status" ADD VALUE 'completed';--> statement-breakpoint
ALTER TYPE "public"."test_result_status" ADD VALUE 'errored';