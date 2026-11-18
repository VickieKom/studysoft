-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #116: warm-ups — a picture (a file) or a list of questions (no file); a game may double as a warm-up.
-- Dropping NOT NULL is instant and only widens what the column holds: the
-- application is its only reader, and only the new code writes a row without
-- a file (a questions warm-up).
-- squawk-ignore ban-drop-not-null
ALTER TABLE "library_material" ALTER COLUMN "blob_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "library_material" ADD COLUMN "questions" text[];--> statement-breakpoint
ALTER TABLE "library_material" ADD COLUMN "warmup" boolean DEFAULT false NOT NULL;