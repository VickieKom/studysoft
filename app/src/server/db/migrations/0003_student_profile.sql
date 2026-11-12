-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #41: profile fields of the student card, all optional plain text.
ALTER TABLE "student" ADD COLUMN "age" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "school_year" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "interests" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "what_works" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "gaps" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "textbook" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "current_unit" text;