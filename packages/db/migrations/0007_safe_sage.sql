ALTER TABLE "reviews" ADD COLUMN "rubric_accuracy" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "rubric_style" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "rubric_readability" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "rubric_hooks" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "rubric_cliches" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rubric_check" CHECK ((
        (rubric_accuracy is null or (rubric_accuracy >= 1 and rubric_accuracy <= 5)) and
        (rubric_style is null or (rubric_style >= 1 and rubric_style <= 5)) and
        (rubric_readability is null or (rubric_readability >= 1 and rubric_readability <= 5)) and
        (rubric_hooks is null or (rubric_hooks >= 1 and rubric_hooks <= 5)) and
        (rubric_cliches is null or (rubric_cliches >= 1 and rubric_cliches <= 5))
      ));