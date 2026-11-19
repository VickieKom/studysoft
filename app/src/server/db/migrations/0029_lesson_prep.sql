-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #151: a student's textbook and passed lesson, and the preparation of a lesson. Nullable columns and a new table.
CREATE TABLE "lesson_plan" (
	"lesson_id" uuid PRIMARY KEY NOT NULL,
	"teacher_id" uuid NOT NULL,
	"plan" jsonb,
	"draft" jsonb,
	"homework_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "textbook_id" uuid;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "passed_lesson_id" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "passed_lesson_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson_plan" ADD CONSTRAINT "lesson_plan_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_plan" ADD CONSTRAINT "lesson_plan_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_plan" ADD CONSTRAINT "lesson_plan_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: the column is new and empty, so there is nothing to scan; new rows are checked all the same.
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "student" ADD CONSTRAINT "student_textbook_id_textbook_id_fk" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbook"("id") ON DELETE no action ON UPDATE no action NOT VALID;