-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #313: who made an assessment draft, the period it was drafted from, and the teacher's first action on it. Nullable or defaulted columns, no rewrite.
ALTER TABLE "assessment" ADD COLUMN "created_by" text DEFAULT 'teacher' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "assessment" ADD COLUMN "teacher_edited_at" timestamp with time zone;