-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #147: results of games the teacher runs with the student during a lesson.
ALTER TABLE "game_result" ADD COLUMN "played_with_teacher" boolean DEFAULT false NOT NULL;