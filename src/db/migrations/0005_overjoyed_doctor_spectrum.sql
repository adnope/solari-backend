CREATE TABLE "friend_nicknames" (
	"setter_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_nicknames_setter_id_target_id_pk" PRIMARY KEY("setter_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "friend_nicknames" ADD CONSTRAINT "friend_nicknames_setter_id_users_id_fk" FOREIGN KEY ("setter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_nicknames" ADD CONSTRAINT "friend_nicknames_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;