-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #236: a word's example sentence. A nullable column, no rewrite.
ALTER TABLE "vocabulary_word" ADD COLUMN "example" text;