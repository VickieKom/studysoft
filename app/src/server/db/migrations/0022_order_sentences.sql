-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #161: an order task of several sentences keeps each sentence's result and the teacher's mark on it.
-- A nullable column without a default is added without rewriting the table.
ALTER TABLE "homework_answer" ADD COLUMN "sentence_verdicts" jsonb;