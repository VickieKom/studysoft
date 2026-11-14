-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #81: moved lessons keep where they came from; every lesson has its own meeting link.
ALTER TABLE "lesson" ADD COLUMN "moved_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "meeting_link" text;
