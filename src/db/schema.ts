import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  unique,
  check,
  uuid,
  foreignKey,
  uniqueIndex,
  bigint,
  integer,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const schemaMigrations = pgTable("schema_migrations", {
  filename: text().primaryKey().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().notNull(),
    username: citext("username").notNull(),
    email: citext("email").notNull(),
    displayName: text("display_name"),
    avatarKey: text("avatar_key"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_users_email").using("btree", table.email.asc().nullsLast().op("citext_ops")),
    index("idx_users_username").using("btree", table.username.asc().nullsLast().op("citext_ops")),
    unique("users_username_key").on(table.username),
    unique("users_email_key").on(table.email),
    check(
      "username_len",
      sql`(length((username)::text) >= 4) AND (length((username)::text) <= 32)`,
    ),
  ],
);

export const userPasswords = pgTable(
  "user_passwords",
  {
    userId: uuid("user_id").primaryKey().notNull(),
    passwordHash: text("password_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_passwords_user_id_fkey",
    }).onDelete("cascade"),
  ],
);

export const userOauthAccounts = pgTable(
  "user_oauth_accounts",
  {
    id: uuid().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    provider: text().notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_user_oauth_accounts_user_id").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_oauth_accounts_user_id_fkey",
    }).onDelete("cascade"),
    unique("user_oauth_accounts_provider_unique").on(table.provider, table.providerUserId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("idx_sessions_expires_at").using(
      "btree",
      table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
    ),
    index("idx_sessions_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "sessions_user_id_fkey",
    }).onDelete("cascade"),
    unique("sessions_refresh_token_hash_key").on(table.refreshTokenHash),
    check("sessions_expiry_check", sql`expires_at > created_at`),
  ],
);

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: uuid().primaryKey().notNull(),
    requesterId: uuid("requester_id").notNull(),
    receiverId: uuid("receiver_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_friend_requests_receiver_id").using(
      "btree",
      table.receiverId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_friend_requests_requester_id").using(
      "btree",
      table.requesterId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.requesterId],
      foreignColumns: [users.id],
      name: "friend_requests_requester_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.receiverId],
      foreignColumns: [users.id],
      name: "friend_requests_receiver_id_fkey",
    }).onDelete("cascade"),
    unique("friend_requests_unique_pair").on(table.requesterId, table.receiverId),
    check("friend_requests_no_self", sql`requester_id <> receiver_id`),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid().primaryKey().notNull(),
    authorId: uuid("author_id").notNull(),
    caption: text(),
    audienceType: text("audience_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_posts_author_created_at").using(
      "btree",
      table.authorId.asc().nullsLast().op("timestamptz_ops"),
      table.createdAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.authorId],
      foreignColumns: [users.id],
      name: "posts_author_id_fkey",
    }).onDelete("cascade"),
    check(
      "posts_audience_type_check",
      sql`audience_type = ANY (ARRAY['all'::text, 'selected'::text])`,
    ),
  ],
);

export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id").primaryKey().notNull(),
    mediaType: text("media_type").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms"),
    thumbnailKey: text("thumbnail_key"),
    width: integer().notNull(),
    height: integer().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("idx_post_media_object_key").using(
      "btree",
      table.objectKey.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.postId],
      foreignColumns: [posts.id],
      name: "post_media_post_id_fkey",
    }).onDelete("cascade"),
    check(
      "post_media_media_type_check",
      sql`media_type = ANY (ARRAY['image'::text, 'video'::text])`,
    ),
    check("post_media_byte_size_check", sql`byte_size > 0`),
    check("post_media_width_check", sql`width > 0`),
    check("post_media_height_check", sql`height > 0`),
    check("post_media_square_check", sql`width = height`),
    check(
      "post_media_duration_check",
      sql`((media_type = 'video'::text) AND (duration_ms IS NOT NULL) AND (duration_ms > 0) AND (duration_ms <= 4000)) OR ((media_type = 'image'::text) AND (duration_ms IS NULL))`,
    ),
  ],
);

export const postReactions = pgTable(
  "post_reactions",
  {
    id: uuid().primaryKey().notNull(),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    emoji: text().notNull(),
    note: text(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_post_reactions_post_id_created_at").using(
      "btree",
      table.postId.asc().nullsLast().op("timestamptz_ops"),
      table.createdAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.postId],
      foreignColumns: [posts.id],
      name: "post_reactions_post_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "post_reactions_user_id_fkey",
    }).onDelete("cascade"),
    check("post_reactions_emoji_check", sql`(length(emoji) > 0) AND (length(emoji) <= 10)`),
    check("post_reactions_note_check", sql`length(note) <= 20`),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid().primaryKey().notNull(),
    userLow: uuid("user_low").notNull(),
    userHigh: uuid("user_high").notNull(),
    userLowClearedAt: timestamp("user_low_cleared_at", { withTimezone: true, mode: "string" }),
    userHighClearedAt: timestamp("user_high_cleared_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    userLowLastReadAt: timestamp("user_low_last_read_at", { withTimezone: true, mode: "string" }),
    userHighLastReadAt: timestamp("user_high_last_read_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("idx_conversations_updated_at").using(
      "btree",
      table.updatedAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    index("idx_conversations_user_high").using(
      "btree",
      table.userHigh.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_conversations_user_low").using(
      "btree",
      table.userLow.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userLow],
      foreignColumns: [users.id],
      name: "conversations_user_low_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userHigh],
      foreignColumns: [users.id],
      name: "conversations_user_high_fkey",
    }).onDelete("cascade"),
    unique("conversations_unique_pair").on(table.userLow, table.userHigh),
    check("conversations_no_self", sql`user_low <> user_high`),
    check("conversations_canonical_order", sql`user_low < user_high`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().notNull(),
    conversationId: uuid("conversation_id").notNull(),
    senderId: uuid("sender_id").notNull(),
    content: text().notNull(),
    referencedPostId: uuid("referenced_post_id"),
    repliedMessageId: uuid("replied_message_id"), // NEW: Reference to parent message
    isDeleted: boolean("is_deleted").default(false).notNull(), // NEW: Soft delete flag
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_messages_conversation_id_created_at").using(
      "btree",
      table.conversationId.asc().nullsLast().op("timestamptz_ops"),
      table.createdAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
      name: "messages_conversation_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.senderId],
      foreignColumns: [users.id],
      name: "messages_sender_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.referencedPostId],
      foreignColumns: [posts.id],
      name: "messages_referenced_post_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.repliedMessageId],
      foreignColumns: [table.id],
      name: "messages_replied_message_id_fkey",
    }).onDelete("set null"),

    check("messages_content_check", sql`is_deleted = true OR length(TRIM(BOTH FROM content)) > 0`),
  ],
);

export const messageReactions = pgTable(
  "message_reactions",
  {
    id: uuid().primaryKey().notNull(),
    messageId: uuid("message_id").notNull(),
    userId: uuid("user_id").notNull(),
    emoji: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_message_reactions_message_id").using(
      "btree",
      table.messageId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.messageId],
      foreignColumns: [messages.id],
      name: "message_reactions_message_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "message_reactions_user_id_fkey",
    }).onDelete("cascade"),
    unique("message_reactions_unique_user_message").on(table.messageId, table.userId),
    check("message_reactions_emoji_check", sql`(length(emoji) > 0) AND (length(emoji) <= 10)`),
  ],
);

export const userDevices = pgTable(
  "user_devices",
  {
    id: uuid().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    deviceToken: text("device_token").notNull(),
    platform: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_user_devices_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_devices_user_id_fkey",
    }).onDelete("cascade"),
    unique("user_devices_device_token_key").on(table.deviceToken),
  ],
);

export const passwordResetCodes = pgTable(
  "password_reset_codes",
  {
    id: uuid().primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "string" }),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_password_reset_codes_expires_at").using(
      "btree",
      table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
    ),
    index("idx_password_reset_codes_user_id").using(
      "btree",
      table.userId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "password_reset_codes_user_id_fkey",
    }).onDelete("cascade"),
    unique("password_reset_codes_code_hash_key").on(table.codeHash),
    check("password_reset_codes_attempt_count_check", sql`attempt_count >= 0`),
    check("password_reset_codes_expiry_check", sql`expires_at > created_at`),
  ],
);

export const friendships = pgTable(
  "friendships",
  {
    userLow: uuid("user_low").notNull(),
    userHigh: uuid("user_high").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_friendships_user_high").using(
      "btree",
      table.userHigh.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_friendships_user_low").using(
      "btree",
      table.userLow.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.userLow],
      foreignColumns: [users.id],
      name: "friendships_user_low_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userHigh],
      foreignColumns: [users.id],
      name: "friendships_user_high_fkey",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.userLow, table.userHigh], name: "friendships_pkey" }),
    check("friendships_no_self", sql`user_low <> user_high`),
    check("friendships_canonical_order", sql`user_low < user_high`),
  ],
);

export const postVisibility = pgTable(
  "post_visibility",
  {
    postId: uuid("post_id").notNull(),
    viewerId: uuid("viewer_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_post_visibility_viewer_id_post_id").using(
      "btree",
      table.viewerId.asc().nullsLast().op("uuid_ops"),
      table.postId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.postId],
      foreignColumns: [posts.id],
      name: "post_visibility_post_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.viewerId],
      foreignColumns: [users.id],
      name: "post_visibility_viewer_id_fkey",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.postId, table.viewerId], name: "post_visibility_pkey" }),
  ],
);

export const postViews = pgTable(
  "post_views",
  {
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_post_views_post_id_viewed_at").using(
      "btree",
      table.postId.asc().nullsLast().op("timestamptz_ops"),
      table.viewedAt.desc().nullsFirst().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.postId],
      foreignColumns: [posts.id],
      name: "post_views_post_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "post_views_user_id_fkey",
    }).onDelete("cascade"),
    primaryKey({ columns: [table.postId, table.userId], name: "post_views_pkey" }),
  ],
);

export const blockedUsers = pgTable(
  "blocked_users",
  {
    blockerId: uuid("blocker_id").notNull(),
    blockedId: uuid("blocked_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_blocked_users_blocker_id").using(
      "btree",
      table.blockerId.asc().nullsLast().op("uuid_ops"),
    ),
    index("idx_blocked_users_blocked_id").using(
      "btree",
      table.blockedId.asc().nullsLast().op("uuid_ops"),
    ),

    foreignKey({
      columns: [table.blockerId],
      foreignColumns: [users.id],
      name: "blocked_users_blocker_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.blockedId],
      foreignColumns: [users.id],
      name: "blocked_users_blocked_id_fkey",
    }).onDelete("cascade"),

    primaryKey({ columns: [table.blockerId, table.blockedId], name: "blocked_users_pkey" }),

    check("blocked_users_no_self", sql`blocker_id <> blocked_id`),
  ],
);

export const userStreaks = pgTable(
  "user_streaks",
  {
    id: uuid("id").primaryKey().notNull(),
    userId: uuid("user_id").notNull(),
    currentStreak: integer("current_streak").default(0).notNull(),
    longestStreak: integer("longest_streak").default(0).notNull(),
    lastPostDate: timestamp("last_post_date", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "user_streaks_user_id_fkey",
    }).onDelete("cascade"),
    unique("user_streaks_user_id_key").on(table.userId),
  ],
);

export const mutedConversations = pgTable(
  "muted_conversations",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    mutedAt: timestamp("muted_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.conversationId] }),
  ]
);
