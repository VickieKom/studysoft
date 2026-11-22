-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #337: the requests of «Привлечение клиентов». A new table.
CREATE TABLE "client_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"first_name" text,
	"age" integer,
	"school_year" text,
	"contact" text,
	"source" text NOT NULL,
	"requested_on" date NOT NULL,
	"stage" text DEFAULT 'request' NOT NULL,
	"decline_reason" text,
	"decline_comment" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_request" ADD CONSTRAINT "client_request_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_request_teacher_id_idx" ON "client_request" USING btree ("teacher_id");