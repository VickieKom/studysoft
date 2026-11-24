-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #254: the teacher's scores of writing and speaking, and when they went into «Прогресс». Nullable columns.
ALTER TABLE "assessment" ADD COLUMN "criteria" jsonb;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "progress_written_at" timestamp with time zone;