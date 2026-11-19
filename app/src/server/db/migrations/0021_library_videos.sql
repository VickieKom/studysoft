-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #117: a video link keeps its address; an own video keeps its file (blob_id may be empty since #116).
ALTER TABLE "library_material" ADD COLUMN "url" text;