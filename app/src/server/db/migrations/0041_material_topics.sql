-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #290: a material's topics as a list. A constant default adds no rewrite.
ALTER TABLE "library_material" ADD COLUMN "topics" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- The single topic becomes the only one. The table holds one teacher's library, a few hundred rows at most.
-- The old column stays, no longer read or written, until every environment runs this (#299).
UPDATE "library_material" SET "topics" = ARRAY["topic"] WHERE "topic" IS NOT NULL;
