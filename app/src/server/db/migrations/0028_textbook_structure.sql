-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #150: a textbook's confirmed structure and its draft. Nullable columns without defaults: no table rewrite.
ALTER TABLE "textbook" ADD COLUMN "structure" jsonb;--> statement-breakpoint
ALTER TABLE "textbook" ADD COLUMN "structure_draft" jsonb;--> statement-breakpoint
ALTER TABLE "textbook" ADD COLUMN "structure_draft_by" text;