ALTER TABLE "images" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "images_id_idx" ON "images" USING btree ("id");