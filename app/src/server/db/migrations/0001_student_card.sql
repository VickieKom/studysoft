-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #18: the student card. The name moves from display_name to first_name in
-- two steps: this migration adds the new columns and copies the name, 0002
-- makes first_name required and drops the old column.
ALTER TABLE "student" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "level" text DEFAULT 'A1' NOT NULL;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "time_zone" text DEFAULT 'Europe/Moscow' NOT NULL;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "status" text DEFAULT 'discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "student" SET "first_name" = "display_name" WHERE "first_name" IS NULL;
