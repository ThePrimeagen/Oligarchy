CREATE TABLE "process_stats" (
	"url" text PRIMARY KEY NOT NULL,
	"type" "server_type" NOT NULL,
	"jobs" integer NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"cpu_percent" double precision NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "process_stats" ADD CONSTRAINT "process_stats_url_servers_url_fk" FOREIGN KEY ("url") REFERENCES "public"."servers"("url") ON DELETE cascade ON UPDATE no action;