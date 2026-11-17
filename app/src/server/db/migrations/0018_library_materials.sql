-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #115: the teacher's library, games first.
CREATE TABLE "library_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"topic" text,
	"age_group" text NOT NULL,
	"blob_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_material" ADD CONSTRAINT "library_material_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_material" ADD CONSTRAINT "library_material_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "library_material_teacher_id_idx" ON "library_material" USING btree ("teacher_id");