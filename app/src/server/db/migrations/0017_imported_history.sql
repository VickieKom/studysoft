-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #38: past submissions imported from the teacher's old tool, and their answers.
CREATE TABLE "imported_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"task_number" bigint NOT NULL,
	"type" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"correct_answer" text,
	"correct" boolean,
	"topic" text,
	CONSTRAINT "imported_answer_task_key" UNIQUE("submission_id","task_number")
);
--> statement-breakpoint
CREATE TABLE "imported_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"title" text NOT NULL,
	"submitted_on" date NOT NULL,
	"correct_count" bigint NOT NULL,
	"wrong_count" bigint NOT NULL,
	"unchecked_count" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imported_submission_once" UNIQUE("teacher_id","student_id","submitted_on","title")
);
--> statement-breakpoint
ALTER TABLE "imported_answer" ADD CONSTRAINT "imported_answer_submission_id_imported_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."imported_submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_submission" ADD CONSTRAINT "imported_submission_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_submission" ADD CONSTRAINT "imported_submission_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imported_submission_student_id_idx" ON "imported_submission" USING btree ("student_id");