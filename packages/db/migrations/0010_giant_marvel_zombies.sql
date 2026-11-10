CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"selected_text" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_comments_offsets_check" CHECK ("review_comments"."start_offset" >= 0 AND "review_comments"."end_offset" >= "review_comments"."start_offset")
);
--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_article_version_created_idx" ON "review_comments" USING btree ("article_id","version_number","created_at");