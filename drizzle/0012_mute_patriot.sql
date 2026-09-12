CREATE TABLE "agent_servers" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
