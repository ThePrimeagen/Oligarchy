CREATE TABLE "process_stats" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "process_stats_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"type" "server_type" NOT NULL,
	"jobs" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"cpu_percent" double precision NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "name" text;--> statement-breakpoint
CREATE INDEX "process_stats_name_reported_at_idx" ON "process_stats" USING btree ("name","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "servers_name_idx" ON "servers" USING btree ("name");