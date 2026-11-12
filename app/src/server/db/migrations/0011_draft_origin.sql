-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #43: where a draft came from — the assistant, with the student context it was built on.
CREATE TABLE "draft_origin" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"homework_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"context" jsonb NOT NULL,
	"teacher_edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_origin_homework_id_unique" UNIQUE("homework_id")
);
--> statement-breakpoint
ALTER TABLE "draft_origin" ADD CONSTRAINT "draft_origin_homework_id_homework_id_fk" FOREIGN KEY ("homework_id") REFERENCES "public"."homework"("id") ON DELETE no action ON UPDATE no action;
