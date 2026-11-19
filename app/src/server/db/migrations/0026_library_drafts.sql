-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #120: games and warm-ups the assistant saves are drafts until the teacher adds them.
ALTER TABLE "library_material" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_material" ADD COLUMN "teacher_edited_at" timestamp with time zone;