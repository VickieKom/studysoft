-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #224: the workbook task bank, a lesson's tasks. A new table.
CREATE TABLE "textbook_lesson_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"textbook_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"tasks" jsonb,
	"skipped" jsonb,
	"confirmed_at" timestamp with time zone,
	"draft" jsonb,
	"draft_skipped" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "textbook_lesson_tasks" ADD CONSTRAINT "textbook_lesson_tasks_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_lesson_tasks" ADD CONSTRAINT "textbook_lesson_tasks_textbook_id_textbook_id_fk" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbook"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_lesson_tasks_lesson_key" ON "textbook_lesson_tasks" USING btree ("textbook_id","lesson_id");