ALTER TABLE "facts" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "facts" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_supersedes_id_facts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "facts_supersedes_id_idx" ON "facts" USING btree ("supersedes_id");--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_supersedes_self_check" CHECK (supersedes_id IS NULL OR supersedes_id <> id);