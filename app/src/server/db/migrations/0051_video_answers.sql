-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #327: a student's answers to a video's tasks. A new table.
CREATE TABLE "video_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" text NOT NULL,
	"tasks" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"verdicts" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_answer" ADD CONSTRAINT "video_answer_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_answer" ADD CONSTRAINT "video_answer_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_answer_once_key" ON "video_answer" USING btree ("material_id","student_id","lesson_id");--> statement-breakpoint
CREATE INDEX "video_answer_student_id_idx" ON "video_answer" USING btree ("student_id");