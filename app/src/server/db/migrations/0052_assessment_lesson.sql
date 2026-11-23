-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #253: an assessment taken in a lesson: its access, the child's answers, the plays, the speaking recording, the scores. Nullable or defaulted columns, no rewrite.
ALTER TABLE "assessment" ADD COLUMN "open_lesson_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "open_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "listening_plays" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "speaking_recording" uuid;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "scores" jsonb;--> statement-breakpoint
-- NOT VALID: the columns are new and empty, so there is nothing to scan; new rows are checked all the same.
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_open_lesson_id_lesson_id_fk" FOREIGN KEY ("open_lesson_id") REFERENCES "public"."lesson"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
-- squawk-ignore adding-foreign-key-constraint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_speaking_recording_blob_id_fk" FOREIGN KEY ("speaking_recording") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action NOT VALID;
