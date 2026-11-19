-- Fail fast instead of queueing behind a long lock; every migration starts with these.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '60s';--> statement-breakpoint
-- #156: textbook sets, their files (books and tracks) and the rendered pages of the books. New tables only.
CREATE TABLE "textbook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teacher_id" uuid NOT NULL,
	"title" text NOT NULL,
	"level" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"textbook_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"blob_id" uuid NOT NULL,
	"position" bigint NOT NULL,
	"page_count" bigint,
	"render_status" text,
	"render_boot" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_page" (
	"file_id" uuid NOT NULL,
	"number" bigint NOT NULL,
	"blob_id" uuid NOT NULL,
	CONSTRAINT "textbook_page_file_id_number_pk" PRIMARY KEY("file_id","number")
);
--> statement-breakpoint
ALTER TABLE "textbook" ADD CONSTRAINT "textbook_teacher_id_teacher_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teacher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_file" ADD CONSTRAINT "textbook_file_textbook_id_textbook_id_fk" FOREIGN KEY ("textbook_id") REFERENCES "public"."textbook"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_file" ADD CONSTRAINT "textbook_file_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_page" ADD CONSTRAINT "textbook_page_file_id_textbook_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."textbook_file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_page" ADD CONSTRAINT "textbook_page_blob_id_blob_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blob"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "textbook_teacher_id_idx" ON "textbook" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "textbook_file_textbook_id_idx" ON "textbook_file" USING btree ("textbook_id");