-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #333: the newest answer «Фидбэк» showed the teacher. Existing students get the time of the release, so earlier answers count as seen (product owner, 2026-11-24). now() is stable, so the default is stored once and the table is not rewritten.
ALTER TABLE "student" ADD COLUMN "feedback_seen_at" timestamp with time zone DEFAULT now();