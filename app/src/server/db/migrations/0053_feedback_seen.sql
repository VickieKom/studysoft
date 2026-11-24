-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #333: when the teacher last opened a student's card with «Фидбэк». A nullable column, no rewrite.
ALTER TABLE "student" ADD COLUMN "feedback_seen_at" timestamp with time zone;