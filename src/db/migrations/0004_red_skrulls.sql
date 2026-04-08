CREATE TABLE "muted_conversations" (
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"muted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "muted_conversations_user_id_conversation_id_pk" PRIMARY KEY("user_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "muted_conversations" ADD CONSTRAINT "muted_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muted_conversations" ADD CONSTRAINT "muted_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;