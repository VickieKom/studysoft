-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #237: the assistant's draft translation and example of a word. Nullable columns, no rewrite.
ALTER TABLE "vocabulary_word" ADD COLUMN "draft_translation" text;--> statement-breakpoint
ALTER TABLE "vocabulary_word" ADD COLUMN "draft_example" text;