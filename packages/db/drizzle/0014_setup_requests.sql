CREATE TABLE "setup_requests" (
	"iso" text NOT NULL,
	"server_url" text NOT NULL,
	"result_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_requests_iso_server_url_pk" PRIMARY KEY("iso","server_url")
);
--> statement-breakpoint
CREATE INDEX "setup_requests_server_url_idx" ON "setup_requests" USING btree ("server_url");--> statement-breakpoint
CREATE UNIQUE INDEX "setup_requests_result_id_idx" ON "setup_requests" USING btree ("result_id");