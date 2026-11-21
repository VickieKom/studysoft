-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #238: the daily word training's progress on each word. Columns with constant defaults, no rewrite.
ALTER TABLE "vocabulary_word" ADD COLUMN "train_step" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_word" ADD COLUMN "due_on" date;--> statement-breakpoint
ALTER TABLE "vocabulary_word" ADD COLUMN "right_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_word" ADD COLUMN "wrong_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocabulary_word" ADD COLUMN "trained_at" timestamp with time zone;