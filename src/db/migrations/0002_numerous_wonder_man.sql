CREATE TABLE "blocked_users" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_users_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocked_users_no_self" CHECK (blocker_id <> blocked_id)
);
--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_users" ADD CONSTRAINT "blocked_users_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocked_users_blocker_id" ON "blocked_users" USING btree ("blocker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_blocked_users_blocked_id" ON "blocked_users" USING btree ("blocked_id" uuid_ops);