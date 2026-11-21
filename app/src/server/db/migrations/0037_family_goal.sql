-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #266: the family's goal and a personal measure on the student, a lesson's number for it. Nullable columns.
ALTER TABLE "lesson" ADD COLUMN "measure" double precision;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "family_goal" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "measure_name" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "measure_unit" text;