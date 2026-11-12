-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #36: attempts, the teacher's marks and comment; one current submission per homework.
-- The uniqueness moves from one row per homework to one per attempt, which
-- needs locks on homework_answer and homework_submission. They are tiny and
-- empty outside test stands (no staging data before #4), so the lock is
-- instant; the squawk-ignore lines below name each such statement.
-- squawk-ignore ban-drop-constraint
ALTER TABLE "homework_answer" DROP CONSTRAINT "homework_answer_homework_id_task_index_key";--> statement-breakpoint
-- squawk-ignore ban-drop-constraint
ALTER TABLE "homework_submission" DROP CONSTRAINT "homework_submission_homework_id_unique";--> statement-breakpoint
ALTER TABLE "homework" ADD COLUMN "attempt" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "homework" ADD COLUMN "review_comment" text;--> statement-breakpoint
ALTER TABLE "homework_answer" ADD COLUMN "attempt" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_answer" ADD COLUMN "teacher_mark" boolean;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD COLUMN "attempt" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD COLUMN "pending_count" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "homework_submission" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
-- squawk-ignore require-concurrent-index-creation
CREATE UNIQUE INDEX "homework_submission_one_current" ON "homework_submission" USING btree ("homework_id") WHERE "homework_submission"."is_current";--> statement-breakpoint
-- squawk-ignore disallowed-unique-constraint, constraint-missing-not-valid
ALTER TABLE "homework_answer" ADD CONSTRAINT "homework_answer_attempt_task_key" UNIQUE("homework_id","attempt","task_index");--> statement-breakpoint
-- squawk-ignore disallowed-unique-constraint, constraint-missing-not-valid
ALTER TABLE "homework_submission" ADD CONSTRAINT "homework_submission_homework_id_attempt_key" UNIQUE("homework_id","attempt");
