-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #326: a library video's transcript, a nullable column, no rewrite; and its tasks, a new table.
CREATE TABLE "video_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"tasks" jsonb,
	"confirmed_at" timestamp with time zone,
	"draft" jsonb,
	"draft_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_material" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "video_tasks" ADD CONSTRAINT "video_tasks_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_tasks" ADD CONSTRAINT "video_tasks_material_id_library_material_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."library_material"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_tasks_material_key" ON "video_tasks" USING btree ("material_id");