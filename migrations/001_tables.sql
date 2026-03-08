CREATE EXTENSION IF NOT EXISTS citext;



CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY,
  username      citext NOT NULL UNIQUE,
  email         citext NOT NULL UNIQUE,

  display_name  text NULL,
  avatar_key    text NULL,

  password_hash text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT username_len CHECK (length(username::text) BETWEEN 4 AND 32)
);

CREATE INDEX IF NOT EXISTS idx_users_email
  ON users (email);

CREATE INDEX IF NOT EXISTS idx_users_username
  ON users (username);



CREATE TABLE IF NOT EXISTS sessions (
  id                  uuid PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,

  CONSTRAINT sessions_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions(expires_at);



CREATE TABLE IF NOT EXISTS friend_requests (
  id             uuid PRIMARY KEY,
  requester_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT friend_requests_no_self
    CHECK (requester_id <> receiver_id),

  CONSTRAINT friend_requests_unique_pair
    UNIQUE (requester_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_requester_id
  ON friend_requests(requester_id);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_id
  ON friend_requests(receiver_id);



CREATE TABLE IF NOT EXISTS friendships (
  user_low    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_low, user_high),

  CONSTRAINT friendships_no_self
    CHECK (user_low <> user_high),

  CONSTRAINT friendships_canonical_order
    CHECK (user_low < user_high)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_low
  ON friendships(user_low);

CREATE INDEX IF NOT EXISTS idx_friendships_user_high
  ON friendships(user_high);



CREATE TABLE IF NOT EXISTS posts (
  id             uuid PRIMARY KEY,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caption        text NULL,
  audience_type  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT posts_audience_type_check
    CHECK (audience_type IN ('all', 'selected'))
);

CREATE INDEX IF NOT EXISTS idx_posts_author_created_at
  ON posts(author_id, created_at DESC);



CREATE TABLE IF NOT EXISTS post_media (
  post_id        uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  media_type     text NOT NULL,
  object_key     text NOT NULL,
  content_type   text NOT NULL,
  byte_size      bigint NOT NULL,
  duration_ms    int NULL,
  thumbnail_key  text NULL,
  width          int NOT NULL,
  height         int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_media_media_type_check
    CHECK (media_type IN ('image', 'video')),

  CONSTRAINT post_media_byte_size_check
    CHECK (byte_size > 0),

  CONSTRAINT post_media_width_check
    CHECK (width > 0),

  CONSTRAINT post_media_height_check
    CHECK (height > 0),

  CONSTRAINT post_media_square_check
    CHECK (width = height),

  CONSTRAINT post_media_duration_check
    CHECK (
      (media_type = 'video' AND duration_ms IS NOT NULL AND duration_ms > 0 AND duration_ms <= 3000)
      OR
      (media_type = 'image' AND duration_ms IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_media_object_key
  ON post_media(object_key);



CREATE TABLE IF NOT EXISTS post_visibility (
  post_id      uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (post_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_post_visibility_viewer_id_post_id
  ON post_visibility(viewer_id, post_id);



CREATE TABLE IF NOT EXISTS post_reactions (
  id          uuid PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  note        text NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_reactions_emoji_check CHECK (length(emoji) > 0 AND length(emoji) <= 10),
  CONSTRAINT post_reactions_note_check CHECK (length(note) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_post_reactions_post_id_created_at
  ON post_reactions(post_id, created_at DESC);



CREATE TABLE IF NOT EXISTS post_views (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_views_post_id_viewed_at
  ON post_views(post_id, viewed_at DESC);



CREATE TABLE IF NOT EXISTS conversations (
  id                    uuid PRIMARY KEY,
  user_low              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  user_low_cleared_at   timestamptz NULL,
  user_high_cleared_at  timestamptz NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

 CONSTRAINT conversations_no_self
 CHECK (user_low <> user_high),

 CONSTRAINT conversations_canonical_order
 CHECK (user_low < user_high),

 CONSTRAINT conversations_unique_pair
 UNIQUE (user_low, user_high)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_low ON conversations(user_low);
CREATE INDEX IF NOT EXISTS idx_conversations_user_high ON conversations(user_high);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);



CREATE TABLE IF NOT EXISTS messages (
  id                  uuid PRIMARY KEY,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  content             text NOT NULL,
  referenced_post_id  uuid NULL REFERENCES posts(id) ON DELETE SET NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT messages_content_check
    CHECK (length(trim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id_created_at
  ON messages(conversation_id, created_at DESC);



CREATE TABLE IF NOT EXISTS message_reactions (
  id          uuid PRIMARY KEY,
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_reactions_emoji_check
  CHECK (length(emoji) > 0 AND length(emoji) <= 10),

  CONSTRAINT message_reactions_unique_user_message
    UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
  ON message_reactions(message_id);
