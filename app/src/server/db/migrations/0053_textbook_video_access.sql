-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #329: a textbook video opened to a student from a lesson's preparation. A new table.
CREATE TABLE "textbook_video_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"tasks" jsonb NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "textbook_video_access" ADD CONSTRAINT "textbook_video_access_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_video_access" ADD CONSTRAINT "textbook_video_access_file_id_textbook_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."textbook_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_video_access" ADD CONSTRAINT "textbook_video_access_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_video_access" ADD CONSTRAINT "textbook_video_access_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_video_access_lesson_file_key" ON "textbook_video_access" USING btree ("lesson_id","file_id");--> statement-breakpoint
CREATE INDEX "textbook_video_access_student_id_idx" ON "textbook_video_access" USING btree ("student_id");