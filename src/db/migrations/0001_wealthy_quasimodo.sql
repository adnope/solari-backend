ALTER TABLE "post_visibility" ADD COLUMN "friend_low_id" uuid;--> statement-breakpoint
ALTER TABLE "post_visibility" ADD COLUMN "friend_high_id" uuid;--> statement-breakpoint
ALTER TABLE "post_visibility" ADD CONSTRAINT "post_visibility_friendship_fk" FOREIGN KEY ("friend_low_id","friend_high_id") REFERENCES "public"."friendships"("user_low","user_high") ON DELETE cascade ON UPDATE no action;