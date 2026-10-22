CREATE TABLE "article_generation_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_generation_confirmations_article_unique" UNIQUE("article_id")
);
--> statement-breakpoint
ALTER TABLE "generation_runs" ADD COLUMN "questions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "article_generation_confirmations" ADD CONSTRAINT "article_generation_confirmations_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_generation_confirmations" ADD CONSTRAINT "article_generation_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_generation_confirmations_article_idx" ON "article_generation_confirmations" USING btree ("article_id");