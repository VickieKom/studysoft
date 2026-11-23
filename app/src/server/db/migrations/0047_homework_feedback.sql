-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #331: «Мини-вопрос после домашки» on a homework, a defaulted column, no rewrite; and the child's answers, a new table.
CREATE TABLE "homework_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"homework_id" uuid NOT NULL,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homework" ADD COLUMN "ask_feedback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_feedback" ADD CONSTRAINT "homework_feedback_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_feedback" ADD CONSTRAINT "homework_feedback_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_feedback" ADD CONSTRAINT "homework_feedback_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "homework_feedback_homework_key" ON "homework_feedback" USING btree ("homework_id");--> statement-breakpoint
CREATE INDEX "homework_feedback_student_id_idx" ON "homework_feedback" USING btree ("student_id");