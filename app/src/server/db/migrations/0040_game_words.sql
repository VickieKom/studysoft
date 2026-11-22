-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #282: a library game marked as a template gets a student's words. A constant default adds no rewrite.
ALTER TABLE "library_material" ADD COLUMN "vocabulary" boolean DEFAULT false NOT NULL;
