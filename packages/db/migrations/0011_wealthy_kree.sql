CREATE TABLE "article_drafts" (
	"article_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"article_markdown" text NOT NULL,
	"seo_title" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"description" text NOT NULL,
	"image_prompt" text NOT NULL,
	"advertising_label" boolean DEFAULT false NOT NULL,
	"disclaimer_text" text,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_drafts" ADD CONSTRAINT "article_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;