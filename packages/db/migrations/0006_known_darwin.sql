ALTER TABLE "reviews" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK (rating is null or (rating >= 1 and rating <= 5));