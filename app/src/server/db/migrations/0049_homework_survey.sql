-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #332: the survey about the lessons sent with a homework. A new table.
CREATE TABLE "homework_survey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"homework_id" uuid NOT NULL,
	"period_from" timestamp with time zone NOT NULL,
	"period_to" timestamp with time zone NOT NULL,
	"questions" jsonb NOT NULL,
	"answers" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"answered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homework_survey" ADD CONSTRAINT "homework_survey_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_survey" ADD CONSTRAINT "homework_survey_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homework_survey" ADD CONSTRAINT "homework_survey_student_teacher_fk" FOREIGN KEY ("student_id","teacher_id") REFERENCES "public"."student"("id","teacher_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "homework_survey_homework_key" ON "homework_survey" USING btree ("homework_id");--> statement-breakpoint
CREATE INDEX "homework_survey_student_id_idx" ON "homework_survey" USING btree ("student_id");