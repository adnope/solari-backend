# Global success response:

## Response body:

- Endpoint-specific

## Status codes:

- [200 OK] - Operation performed successfully
- [201 Created] - Resource created
- [202 Accepted] - Request accepted & admitted for processing

# Global error responses:

## Response body:

```json
{
  "error": {
    "type": "<endpoint specific error type>",
    "message": "<endpoint specific error message>"
  }
}
```

## Status codes:

- [400 Bad Request] - Input validation failed
- [401 Unauthorized] - User is not authorized for operation
- [403 Forbidden] - User doesn't satisfy conditions for operation
- [404 Not Found] - Resource not found
- [409 Conflict] - Data update is conflicting with existing data
- [410 Gone] - Resource no longer exists
- [500 Internal Server Error] - Unexpected server error occurred (all errors have this)

# Auth Endpoints:

## Sign up

- Endpoint:

```
POST /signup
```

- Description: Creates a new user account.
- Auth required: No

### Request body (application/json):

- username (string, Required): Must be between 4 and 32 characters. Can only contain letters, numbers, underscores (\_), and dots (.).
- email (string, Required): Must be a valid email format.
- password (string, Required): Must be at least 6 characters long.
- Example:

```json
{
  "username": "user1234",
  "email": "user1234@example.com",
  "password": "userpassword"
}
```

### Responses:

- [201 Created] - Account successfully created.

```json
{
  "message": "Account created successfully.",
  "user": {
    "id": "018f9e...",
    "username": "johndoe",
    "email": "john@example.com",
    "display_name": null,
    "avatar_key": null,
    "created_at": "2026-04-08T11:49:14.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_USERNAME, INVALID_USERNAME, MISSING_EMAIL, INVALID_EMAIL, MISSING_PASSWORD, WEAK_PASSWORD.
- [409 Conflict] - Possible 'type' values: USERNAME_TAKEN, EMAIL_TAKEN, IDENTIFIER_ALREADY_IN_USE.

## Sign in

- Endpoint:

```
POST /signin
```

- Description: Authenticates a user and creates a new session. Accepts either a username or an email address.
- Auth required: No

### Request body (application/json):

- identifier (string, Required): The user's username or email address.
- password (string, Required): The user's password.
- Example:

```json
{
  "identifier": "user1234@example.com",
  "password": "userpassword"
}
```

### Responses:

- [200 OK] - Signed in successfully.

```json
{
  "message": "Signed in successfully.",
  "session_id": "018f9e...",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR...",
  "refresh_token": "a1b2c3d4e5f6...",
  "expires_at": "2026-04-22T11:49:14.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_IDENTIFIER, MISSING_PASSWORD.
- [401 Unauthorized] - Possible 'type' values: INVALID_CREDENTIALS, LINKED_THIRD_PARTY_ACCOUNT.

## Sign out

- Endpoint:

```
POST /signout
```

- Description: Invalidates the active session by deleting it from the database. Optionally accepts a device token to unregister the device, ensuring the user stops receiving push notifications on that specific device after signing out.
- Auth required: Yes

### Request body (application/json):

- device_token (string, Optional): The push notification device token to be removed from the user's registered devices.
- Example:
  ```json
  {
    "device_token": "fcm_token_xyz123..."
  }
  ```

### Responses:

- [200 OK] - Logged out successfully.

```json
{
  "message": "Logged out successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_SESSION_ID.
- [404 Not Found] - Possible 'type' values: SESSION_NOT_FOUND.

## Request password reset code

- Endpoint:

```
POST /password-resets
```

- Description: Requests a 6-digit password reset code to be sent to the provided email address. To prevent email enumeration attacks, this endpoint always returns a 200 success message regardless of whether the account actually exists in the database.
- Auth required: No

### Request body (application/json):

- email (string, Required): The email address associated with the user account. Must be a valid email format.
- Example:

```json
{
  "email": "user1234@example.com"
}
```

### Responses:

- [200 OK] - Request accepted and processing initiated.

```json
{
  "message": "If that account exists, a password reset code has been sent."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_EMAIL, INVALID_EMAIL.

## Verify password reset code

- Endpoint:

```
POST /password-resets/verify
```

- Description: Verifies a 6-digit password reset code sent to the user's email. Features brute-force protection, automatically invalidating the code after 5 failed attempts. To prevent account enumeration, invalid emails or expired/incorrect codes all return the same generic error.
- Auth required: No

### Request body (application/json):

- email (string, Required): The email address associated with the account. Must be a valid email format.
- code (string, Required): The 6-digit reset code sent to the user.
- Example:

```json
{
  "email": "user1234@example.com",
  "code": "123456"
}
```

### Responses:

- [200 OK] - Password reset code verified successfully.

```json
{
  "message": "Password reset code verified successfully.",
  "verified": true
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_EMAIL, INVALID_EMAIL, MISSING_CODE, INVALID_CODE.

## Set new password

- Endpoint:

```
POST /password-resets/complete
```

- Description: Completes the password reset process by setting a new password. Requires a previously verified, unexpired, and unused reset code for the provided email. Upon success, the reset code is marked as used and all existing sessions for the user are invalidated, requiring them to sign in again.
- Auth required: No

### Request body (application/json):

- email (string, Required): The email address associated with the account. Must be a valid email format.
- new_password (string, Required): The new password for the account. Must be at least 6 characters long.
- Example:

```json
{
  "email": "user1234@example.com",
  "new_password": "newSecurePassword123"
}
```

### Responses:

- [200 OK] - Password reset successfully.

```json
{
  "message": "Password reset successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_EMAIL, INVALID_EMAIL, MISSING_PASSWORD, INVALID_PASSWORD, RESET_NOT_VERIFIED.

## Refresh session

- Endpoint:

```
POST /sessions/refresh
```

- Description: Refreshes an active session. Validates the provided refresh token, then issues a new JWT access token and rotates the refresh token for security. If the current session has expired, it is automatically deleted.
- Auth required: No

### Request body (application/json):

- refresh_token (string, Required): The current valid refresh token associated with the session.
- Example:

```json
{
  "refresh_token": "a1b2c3d4e5f6..."
}
```

### Responses:

- [200 OK] - Session refreshed successfully.

```json
{
  "message": "Session refreshed successfully.",
  "session_id": "018f9e...",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR...",
  "refresh_token": "f6e5d4c3b2a1...",
  "expires_at": "2026-04-22T11:49:14.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: INVALID_CREDENTIALS.
- [401 Unauthorized] - Possible 'type' values: SESSION_NOT_FOUND.

## Get current user

- Endpoint:

```
GET /me
```

- Description: Retrieves the profile information of the currently authenticated user based on their active session.
- Auth required: Yes

### Request body:

- None

### Responses:

- [200 OK] - Successfully retrieved user profile.

```json
{
  "message": "Got me",
  "session_id": "018f9e...",
  "user": {
    "id": "018f9e...",
    "username": "johndoe",
    "email": "john@example.com",
    "display_name": null,
    "avatar_url": null,
    "created_at": "2026-04-08T11:49:14.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_USER_ID.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.

# Conversation Endpoints

## Create a conversation

- Endpoint:

```
POST /conversations
```

- Description: Creates a new direct messaging conversation between the authenticated user and a target user. If a conversation between the two users already exists, it idempotently returns the existing conversation. Features privacy protections by returning a generic "Not Found" error if the target user has blocked the requester or vice versa.
- Auth required: Yes

### Request body (application/json):

- target_user_id (string, Required): The UUID of the user to start a conversation with. Must be a valid formatted UUID.
- Example:

```json
{
  "target_user_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Responses:

- [201 Created] - Conversation created or retrieved successfully.

```json
{
  "message": "Conversation created.",
  "conversation": {
    "id": "018f9e...",
    "user_low": "123e4567-e89b-12d3-a456-426614174000",
    "user_high": "987f6543-e21b-34c4-b567-513314175000",
    "created_at": "2026-04-08T12:40:02.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, CANNOT_CHAT_WITH_SELF, USER_NOT_FOUND.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.

## Send a message

- Endpoint:

```
POST /conversations/:conversationId/messages
```

- Description: Sends a direct message in a specified conversation. Can optionally act as a reply to a post or another message, but not both simultaneously. Verifies friendship status and automatically dispatches real-time WebSocket events and push notifications.
- Auth required: Yes

### Request body (application/json):

- content (string, Required): The content of the message. Cannot be empty.
- referenced_post_id (string, Optional): The UUID of a post being referenced. Cannot be the user's own post.
- replied_message_id (string, Optional): The UUID of a specific message in the conversation being replied to. Cannot be a deleted message.
- Example:

```json
{
  "content": "Yo!",
  "referenced_post_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Responses:

- [201 Created] - Message sent successfully.

```json
{
  "message": "Message sent successfully.",
  "data": {
    "id": "018f9e...",
    "conversation_id": "123e4567-e89b-12d3-a456-426614174000",
    "sender_id": "987f6543-e21b-34c4-b567-513314175000",
    "content": "Yo!",
    "referenced_post_id": "123e4567-e89b-12d3-a456-426614174000",
    "replied_message_id": null,
    "created_at": "2026-04-08T12:45:10.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, EMPTY_CONTENT, CANNOT_REFERENCE_OWN_POST, INVALID_REFERENCE_COMBINATION, REPLIED_MESSAGE_UNSENT, REPLIED_MESSAGE_NOT_FOUND.
- [403 Forbidden] - Possible 'type' values: NOT_FRIENDS.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND, POST_NOT_FOUND, REPLIED_MESSAGE_NOT_FOUND.

## Unsend a message

- Endpoint:

```
DELETE /conversations/:conversationId/messages/:messageId
```

- Description: Soft-deletes a specific message within a conversation. Only the original sender can unsend the message. The action is blocked if the conversation is archived (e.g., users are no longer friends or a blocking relationship exists). Successfully unsending a message clears its content in the database and automatically dispatches real-time WebSocket updates to both users.
- Auth required: Yes

### Request body:

- None

### Responses:

- [200 OK] - Message unsent successfully.

```json
{
  "message": "Message unsent successfully.",
  "data": {
    "id": "018f9e...",
    "conversation_id": "123e4567-e89b-12d3-a456-426614174000",
    "is_deleted": true
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED, ARCHIVED.
- [404 Not Found] - Possible 'type' values: MESSAGE_NOT_FOUND.

## Get conversation messages

- Endpoint:

```
GET /conversations/:conversationId/messages
```

- Description: Retrieves a paginated list of messages for a specific conversation. The authenticated user must be a participant in the conversation. Supports cursor-based pagination and respects cleared conversation history (only returning messages sent after the user last cleared the chat). Also returns message reactions and the partner's last read timestamp.
- Auth required: Yes

### Request parameters:

- conversationId (string, Required): The UUID of the conversation (passed as a path parameter).
- limit (string, Optional): The maximum number of messages to return. Max is 100. Defaults to 30 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches messages older than this timestamp (passed as a query parameter).
- Example:

```text
GET /conversations/123e4567-e89b-12d3-a456-426614174000/messages?limit=20&cursor=2026-04-08T12:45:10.000Z
```

### Responses:

- [200 OK] - Messages retrieved successfully.

```json
{
  "items": [
    {
      "id": "018fa1...",
      "sender_id": "987f6543-e21b-34c4-b567-513314175000",
      "content": "Yo!",
      "is_deleted": false,
      "referenced_post_id": null,
      "replied_message_id": null,
      "created_at": "2026-04-08T12:45:10.000Z",
      "reactions": [
        {
          "user_id": "123e4567-e89b-12d3-a456-426614174000",
          "emoji": "💀"
        }
      ]
    }
  ],
  "next_cursor": "2026-04-08T12:40:02.000Z",
  "partner_last_read_at": "2026-04-08T12:46:00.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_CURSOR.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND.

## Mark a conversation as read

- Endpoint:

```
POST /conversations/:conversationId/read
```

- Description: Marks a conversation as read for the authenticated user by updating their last read timestamp to match the latest visible message. If the read state changes, it automatically dispatches a real-time WebSocket update to both participants.
- Auth required: Yes

### Request parameters:

- conversationId (string, Required): The UUID of the conversation (passed as a path parameter).

### Request body:

- None

### Responses:

- [200 OK] - Conversation marked as read.

```json
{
  "message": "Conversation marked as read.",
  "read_state": {
    "conversation_id": "123e4567-e89b-12d3-a456-426614174000",
    "user_id": "987f6543-e21b-34c4-b567-513314175000",
    "last_read_at": "2026-04-08T12:45:10.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND.

## Get all conversations

- Endpoint:

```
GET /conversations
```

- Description: Retrieves a paginated list of conversations for the authenticated user, ordered by the most recently updated. Includes the partner's profile (respecting custom nicknames and privacy blocks), the latest message, read receipts, an `is_readonly` flag if the users are no longer friends, and an `is_muted` flag for the current user's mute state. If the current user is blocked by the partner, the partner's profile is anonymized as "Someone".
- Auth required: Yes

### Request parameters:

- limit (string, Optional): The maximum number of conversations to return. Max is 100. Defaults to 20 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches conversations updated before this timestamp (passed as a query parameter).
- Example:

```text
GET /conversations?limit=20&cursor=2026-04-08T12:45:10.000Z
```

### Responses:

- [200 OK] - Conversations retrieved successfully.

```json
{
  "items": [
    {
      "id": "018f9e...",
      "user_low": "123e4567-e89b-12d3-a456-426614174000",
      "user_high": "987f6543-e21b-34c4-b567-513314175000",
      "created_at": "2026-04-01T10:00:00.000Z",
      "updated_at": "2026-04-08T12:45:10.000Z",
      "partner": {
        "id": "987f6543-e21b-34c4-b567-513314175000",
        "username": "janesmith",
        "display_name": "Jane (Work)",
        "avatar_key": "avatars/018fa1..."
      },
      "last_message": {
        "id": "018fa2...",
        "sender_id": "123e4567-e89b-12d3-a456-426614174000",
        "content": "that's unfortunate",
        "is_deleted": false,
        "created_at": "2026-04-08T12:45:10.000Z"
      },
      "current_user_last_read_at": "2026-04-08T12:45:10.000Z",
      "partner_last_read_at": "2026-04-08T12:40:00.000Z",
      "is_readonly": false,
      "is_muted": false
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_CURSOR.

## Get a single conversation

- Endpoint:

```
GET /conversations/:conversationId
```

- Description: Retrieves one conversation for the authenticated user. Includes the partner's profile (respecting custom nicknames and privacy blocks), the latest message, read receipts, an `is_readonly` flag if the users are no longer friends, and an `is_muted` flag for the current user's mute state. If the current user is blocked by the partner, the partner's profile is anonymized as "Someone".
- Auth required: Yes

### Request parameters:

- conversationId (string, Required): The UUID of the conversation to retrieve (passed as a path parameter).
- Example:

```text
GET /conversations/123e4567-e89b-12d3-a456-426614174000
```

### Request body:

- None

### Responses:

- [200 OK] - Conversation retrieved successfully.

```json
{
  "conversation": {
    "id": "018f9e...",
    "user_low": "123e4567-e89b-12d3-a456-426614174000",
    "user_high": "987f6543-e21b-34c4-b567-513314175000",
    "created_at": "2026-04-01T10:00:00.000Z",
    "updated_at": "2026-04-08T12:45:10.000Z",
    "partner": {
      "id": "987f6543-e21b-34c4-b567-513314175000",
      "username": "janesmith",
      "display_name": "Jane (Work)",
      "avatar_key": "avatars/018fa1..."
    },
    "last_message": {
      "id": "018fa2...",
      "sender_id": "123e4567-e89b-12d3-a456-426614174000",
      "content": "that's unfortunate",
      "is_deleted": false,
      "created_at": "2026-04-08T12:45:10.000Z"
    },
    "current_user_last_read_at": "2026-04-08T12:45:10.000Z",
    "partner_last_read_at": "2026-04-08T12:40:00.000Z",
    "is_readonly": false,
    "is_muted": false
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND.

## Clear a conversation

- Endpoint:

```
DELETE /conversations/:conversationId
```

- Description: Clears the message history of a conversation for the authenticated user. This is a soft-delete operation that updates the user's "cleared at" timestamp. It does not delete the underlying messages from the database, meaning the conversation history remains visible to the other participant.
- Auth required: Yes

### Request parameters:

- conversationId (string, Required): The UUID of the conversation to clear (passed as a path parameter).

### Request body:

- None

### Responses:

- [200 OK] - Conversation cleared successfully.

```json
{
  "message": "Conversation cleared successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND.

## React to a message

- Endpoint:

```
POST /messages/:messageId/reactions
```

- Description: Adds or updates an emoji reaction on a specific message. If the user has already reacted to this message, the existing reaction is updated with the new emoji. Verifies that the message exists, hasn't been unsent, and that the users are not blocked. Automatically dispatches real-time WebSocket events and queues push notifications for the message sender.
- Auth required: Yes

### Request parameters:

- messageId (string, Required): The UUID of the message to react to (passed as a path parameter).

### Request body (application/json):

- emoji (string, Required): A single valid emoji character to use as the reaction.
- Example:

```json
{
  "emoji": "👍"
}
```

### Responses:

- [201 Created] - Reaction recorded successfully.

```json
{
  "message": "Reaction recorded successfully.",
  "data": {
    "id": "018f9e...",
    "message_id": "123e4567-e89b-12d3-a456-426614174000",
    "user_id": "987f6543-e21b-34c4-b567-513314175000",
    "emoji": "👍",
    "created_at": "2026-04-08T12:45:10.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_EMOJI, MESSAGE_DELETED.
- [404 Not Found] - Possible 'type' values: UNAUTHORIZED_OR_NOT_FOUND.

## Remove a message reaction

- Endpoint:

```
DELETE /messages/:messageId/reactions
```

- Description: Removes the authenticated user's reaction from a specific message. The operation is blocked if the conversation is archived (e.g., users are no longer friends or a blocking relationship exists). Automatically dispatches real-time WebSocket updates to both users upon successful removal.
- Auth required: Yes

### Request parameters:

- messageId (string, Required): The UUID of the message to remove the reaction from (passed as a path parameter).

### Request body:

- None

### Responses:

- [200 OK] - Reaction removed successfully.

```json
{
  "message": "Reaction removed successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: ARCHIVED.
- [404 Not Found] - Possible 'type' values: REACTION_NOT_FOUND.

## Update an existing message reaction

- Endpoint:

```
PATCH /messages/:messageId/reactions
```

- Description: Updates an existing emoji reaction on a specific message. The operation is blocked if the user hasn't already reacted to the message, or if the conversation is archived (e.g., users are no longer friends or a blocking relationship exists). Automatically dispatches real-time WebSocket updates to both users upon successful update.
- Auth required: Yes

### Request parameters:

- messageId (string, Required): The UUID of the message containing the reaction to update (passed as a path parameter).

### Request body (application/json):

- emoji (string, Required): The new single valid emoji character to replace the old reaction.
- Example:

```json
{
  "emoji": "💀"
}
```

### Responses:

- [200 OK] - Reaction updated successfully.

```json
{
  "message": "Reaction updated successfully.",
  "data": {
    "id": "018f9e...",
    "message_id": "123e4567-e89b-12d3-a456-426614174000",
    "user_id": "987f6543-e21b-34c4-b567-513314175000",
    "emoji": "💀",
    "created_at": "2026-04-08T12:45:10.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_EMOJI.
- [403 Forbidden] - Possible 'type' values: ARCHIVED.
- [404 Not Found] - Possible 'type' values: REACTION_NOT_FOUND.

## Toggle conversation mute status

- Endpoint:

```
POST /conversations/mute
```

- Description: Toggles the mute status of a specific conversation for the authenticated user. If the conversation is currently muted, it will be unmuted. If it is not muted, it will be muted. Users must be a participant in the conversation to perform this action.
- Auth required: Yes

### Request body (application/json):

- conversation_id (string, Required): The UUID of the conversation to mute or unmute. Must be a valid formatted UUID.
- Example:

```json
{
  "conversation_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Responses:

- [200 OK] - Mute status toggled successfully.

```json
{
  "message": "Conversation muted.",
  "conversation_id": "123e4567-e89b-12d3-a456-426614174000",
  "is_muted": true
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT.
- [404 Not Found] - Possible 'type' values: CONVERSATION_NOT_FOUND.

# Feed Endpoints:

## Get user's feed

- Endpoint:

```
GET /feed
```

- Description: Retrieves a paginated feed of posts visible to the authenticated user. This includes the user's own posts and posts explicitly shared with them (e.g., by friends). Automatically filters out content involving blocking relationships. Resolves secure, presigned URLs for media access and applies custom nicknames for authors if they have been set. Supports optional filtering to only show posts from specific authors.
- Auth required: Yes

### Request parameters:

- limit (string, Optional): The maximum number of posts to return. Max is 100. Defaults to 30 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches posts created before this timestamp (passed as a query parameter).
- authors (string, Optional): A comma-separated list of user UUIDs to filter the feed to only show posts from those specific authors (passed as a query parameter).
- Example:
  ```text
  GET /feed?limit=20&cursor=2026-04-08T12:45:10.000Z&authors=123e4567-e89b-12d3-a456-426614174000,987f6543-e21b-34c4-b567-513314175000
  ```

### Request body:

- None

### Responses:

- [200 OK] - Feed retrieved successfully.

```json
{
  "items": [
    {
      "id": "018f9e...",
      "caption": "Beautiful sunset today!",
      "created_at": "2026-04-08T12:45:10.000Z",
      "author": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "username": "johndoe",
        "display_name": "Johnny (Bestie)",
        "avatar_key": "avatars/018fa1..."
      },
      "media": {
        "url": "https://s3.amazonaws.com/bucket/media_xyz...",
        "thumbnail_url": "https://s3.amazonaws.com/bucket/thumb_xyz...",
        "media_type": "image/jpeg",
        "width": 1080,
        "height": 1350,
        "duration_ms": null
      }
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: INVALID_FILTER, INVALID_CURSOR, INVALID_AUTHORS.
- [404 Not Found] - Possible 'type' values: INVALID_AUTHORS.

## Send a friend request

- Endpoint:

```
POST /friend-requests
```

- Description: Sends a friend request to a user using their username or email address. Validates against self-requests, existing friendships, pending requests, and blocking relationships. Automatically dispatches a real-time WebSocket event and queues a push notification for the receiver.
- Auth required: Yes

### Request body (application/json):

- identifier (string, Required): The target user's username or email address.
- Example:

```json
{
  "identifier": "janesmith"
}
```

### Responses:

- [201 Created] - Friend request sent successfully.

```json
{
  "message": "Friend request to janesmith sent successfully.",
  "friend_request": {
    "id": "018f9e...",
    "requester_id": "123e4567-e89b-12d3-a456-426614174000",
    "receiver_id": "987f6543-e21b-34c4-b567-513314175000",
    "created_at": "2026-04-08T12:51:43.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_IDENTIFIER, SELF_REQUEST.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.
- [409 Conflict] - Possible 'type' values: ALREADY_FRIENDS, REQUEST_ALREADY_SENT, REQUEST_ALREADY_RECEIVED.

## View friend requests

- Endpoint:

```
GET /friend-requests
```

- Description: Retrieves a paginated list of pending friend requests for the authenticated user. Supports filtering by direction (incoming, outgoing, or both) and sorting chronologically. Automatically hides requests where a blocking relationship exists between the users.
- Auth required: Yes

### Request parameters:

- limit (string, Optional): The maximum number of requests to return. Max is 100. Defaults to 20 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches requests created before or after this timestamp depending on the sort order (passed as a query parameter).
- direction (string, Optional): Filters requests by direction. Valid values are 'incoming', 'outgoing', or 'both'. Defaults to 'both' (passed as a query parameter).
- sort (string, Optional): Sorts the results by creation date. Valid values are 'newest' or 'oldest'. Defaults to 'newest' (passed as a query parameter).
- Example:
  ```text
  GET /friend-requests?limit=10&direction=incoming&sort=newest
  ```

### Request body:

- None

### Responses:

- [200 OK] - Friend requests retrieved successfully.

```json
{
  "items": [
    {
      "id": "018f9e...",
      "created_at": "2026-04-08T12:51:43.000Z",
      "direction": "incoming",
      "requester": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "username": "janesmith",
        "email": "jane@example.com",
        "display_name": "Jane Smith",
        "avatar_key": "avatars/018fa1..."
      },
      "receiver": {
        "id": "987f6543-e21b-34c4-b567-513314175000",
        "username": "johndoe",
        "email": "john@example.com",
        "display_name": "John Doe",
        "avatar_key": null
      }
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z",
  "limit": 10,
  "direction": "incoming"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_USER_ID, INVALID_CURSOR, INVALID_LIMIT, INVALID_DIRECTION, INVALID_SORT.

## Accept a friend request

- Endpoint:

```
PATCH /friend-requests/:requestId
```

- Description: Accepts a pending friend request sent to the authenticated user. Upon acceptance, a mutual friendship is established, the request record is removed, and both parties are notified via real-time WebSocket events. The requester also receives a push notification. Validates that the request belongs to the user and that no blocking relationship exists.
- Auth required: Yes

### Request parameters:

- requestId (string, Required): The UUID of the friend request to accept.
- Example:

```text
PATCH /friend-requests/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a
```

### Request body:

- None

### Responses:

- [200 OK] - Friend request accepted successfully.

```json
{
  "message": "Friend request accepted successfully.",
  "friend_request": {
    "id": "018f9e...",
    "requester_id": "123e4567-e89b-12d3-a456-426614174000",
    "receiver_id": "987f6543-e21b-34c4-b567-513314175000",
    "created_at": "2026-04-08T12:51:43.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, SELF_REQUEST.
- [404 Not Found] - Possible 'type' values: REQUEST_NOT_FOUND, USER_NOT_FOUND.
- [409 Conflict] - Possible 'type' values: ALREADY_FRIENDS.

## Cancel or reject a friend request

- Endpoint:

```
DELETE /friend-requests/:requestId
```

- Description: Cancels an outgoing friend request or rejects an incoming one. The authenticated user must be either the original requester or the intended receiver. Upon successful deletion of the request, a real-time WebSocket event is dispatched to both users to update their UI.
- Auth required: Yes

### Request parameters:

- requestId (string, Required): The UUID of the friend request to cancel or reject (passed as a path parameter).

### Request body:

- None

### Responses:

- [200 OK] - Friend request canceled or rejected successfully.

```json
{
  "message": "Friend request canceled or rejected successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: NOT_REQUESTER_OR_RECEIVER.
- [404 Not Found] - Possible 'type' values: REQUEST_NOT_FOUND.

## Unfriend a user

- Endpoint:

```
DELETE /friendships/:friendId
```

- Description: Removes a mutual friendship between the authenticated user and the specified user. Automatically deletes any custom nicknames established between the two users and dispatches real-time WebSocket updates to both parties to reflect the new friendship status.
- Auth required: Yes

### Request parameters:

- friendId (string, Required): The UUID of the friend to remove (passed as a path parameter).
- Example:

```text
DELETE /friendships/123e4567-e89b-12d3-a456-426614174000
```

### Request body:

- None

### Responses:

- [200 OK] - Unfriended successfully.

```json
{
  "message": "Unfriended successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, CANNOT_UNFRIEND_SELF.
- [404 Not Found] - Possible 'type' values: NOT_FRIENDS.

## View friend list

- Endpoint:

```
GET /friends
```

- Description: Retrieves a paginated list of the authenticated user's current friends. Supports sorting by when the friendship was established and applies any custom nicknames set by the user.
- Auth required: Yes

### Request parameters:

- limit (string, Optional): The maximum number of friends to return. Max is 100. Defaults to 20 (passed as a query parameter).
- sort (string, Optional): Sorts the results by when the friendship was created. Valid values are 'newest' or 'oldest'. Defaults to 'newest' (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches friendships created before or after this timestamp depending on the sort order (passed as a query parameter).
- Example:

```text
GET /friends?limit=20&sort=newest
```

### Request body:

- None

### Responses:

- [200 OK] - Friend list retrieved successfully.

```json
{
  "items": [
    {
      "id": "987f6543-e21b-34c4-b567-513314175000",
      "username": "johndoe",
      "display_name": "Johnny",
      "avatar_key": "avatars/018fa1...",
      "created_at": "2026-04-08T12:51:43.000Z"
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z",
  "limit": 20
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_USER_ID, INVALID_CURSOR, INVALID_LIMIT, INVALID_SORT.

# Nickname Endpoints:

## Set a new nickname

- Endpoint:

```
POST /nicknames/:targetUserId
```

- Description: Sets a custom nickname for a specific user. The authenticated user and the target user must currently be friends. Users cannot set a nickname for themselves. If a nickname already exists for the target user, the request will fail and the update endpoint must be used instead.
- Auth required: Yes

### Request parameters:

- targetUserId (string, Required): The UUID of the friend to receive the nickname (passed as a path parameter).

### Request body (application/json):

- nickname (string, Required): The custom nickname to set.
- Example:

```json
{
  "nickname": "League Bro"
}
```

### Responses:

- [201 Created] - Nickname set successfully.

```json
{
  "message": "Nickname set successfully.",
  "data": {
    "target_user_id": "987f6543-e21b-34c4-b567-513314175000",
    "nickname": "League Bro"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT, CANNOT_NICKNAME_SELF.
- [403 Forbidden] - Possible 'type' values: NOT_FRIENDS.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.
- [409 Conflict] - Possible 'type' values: NICKNAME_ALREADY_EXISTS.

## Update an existing nickname

- Endpoint:

```
PATCH /nicknames/:targetUserId
```

- Description: Updates an existing custom nickname for a specific user. The authenticated user must have previously set a nickname for this target user using the set nickname endpoint. If no prior nickname exists, the request will fail.
- Auth required: Yes

### Request parameters:

- targetUserId (string, Required): The UUID of the friend whose nickname is being updated (passed as a path parameter).

### Request body (application/json):

- new_nickname (string, Required): The new custom nickname to apply.
- Example:

```json
{
  "new_nickname": "League Bro (Diamond Hardstuck)"
}
```

### Responses:

- [200 OK] - Nickname updated successfully.

```json
{
  "message": "Nickname updated successfully.",
  "data": {
    "target_user_id": "987f6543-e21b-34c4-b567-513314175000",
    "nickname": "League Bro (Diamond Hardstuck)"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT.
- [404 Not Found] - Possible 'type' values: NICKNAME_NOT_FOUND.

## Remove a nickname

- Endpoint:

```
DELETE /nicknames/:targetUserId
```

- Description: Removes a previously set custom nickname for a specific user. This action reverts the displayed name for that user back to their default display name or username in the authenticated user's view.
- Auth required: Yes

### Request parameters:

- targetUserId (string, Required): The UUID of the friend whose nickname is being removed (passed as a path parameter).
- Example:

```text
DELETE /nicknames/987f6543-e21b-34c4-b567-513314175000
```

### Request body:

- None

### Responses:

- [200 OK] - Nickname removed successfully.

```json
{
  "message": "Nickname removed successfully.",
  "data": {
    "target_user_id": "987f6543-e21b-34c4-b567-513314175000"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT.

## Get a specific nickname

- Endpoint:

```
GET /nicknames/:targetUserId
```

- Description: Retrieves the custom nickname set by the authenticated user for a specific friend. If no nickname has been set for that user, the `nickname` field will be `null`.
- Auth required: Yes

### Request parameters:

- targetUserId (string, Required): The UUID of the friend whose nickname is being retrieved (passed as a path parameter).
- Example:

```text
GET /nicknames/987f6543-e21b-34c4-b567-513314175000
```

### Request body:

- None

### Responses:

- [200 OK] - Nickname retrieved successfully.

```json
{
  "nickname": "Johnny"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT.

## Get all friend nicknames

- Endpoint:

```
GET /nicknames
```

- Description: Retrieves a list of all custom nicknames the authenticated user has assigned to their friends. Returns an empty list if no nicknames have been set.
- Auth required: Yes

### Request parameters:

- None
- Example:

```text
GET /nicknames
```

### Request body:

- None

### Responses:

- [200 OK] - Nicknames retrieved successfully.

```json
{
  "items": [
    {
      "target_id": "987f6543-e21b-34c4-b567-513314175000",
      "nickname": "League Bro (Diamond Hardstuck)"
    },
    {
      "target_id": "123e4567-e89b-12d3-a456-426614174000",
      "nickname": "League Bro 2"
    }
  ]
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_FORMAT.

# Post Endpoints:

## Initiate a post upload

- Endpoint:

```
POST /posts/initiate
```

- Description: Starts the multi-step process for uploading a post. This endpoint performs metadata validation (requiring square dimensions and a maximum video length of 4 seconds), checks audience permissions, and generates a temporary pre-signed S3 URL for direct client-side upload. It also creates a temporary upload ticket in Redis valid for 10 minutes.
- Auth required: Yes

### Request body (application/json):

- content_type (string, Required): The MIME type of the media (e.g., "image/jpeg", "video/mp4").
- caption (string, Optional): A short text description. Max 48 characters.
- audience_type (string, Required): Access level for the post. Must be "all" (visible to all friends) or "selected" (visible only to specified friends).
- viewer_ids (string, Optional): A comma-separated list of user UUIDs. Required if audience_type is "selected"; must be empty if audience_type is "all". Every ID must belong to a current friend.
- width (number, Required): Media width in pixels. Must be a positive integer and equal to the height.
- height (number, Required): Media height in pixels. Must be a positive integer and equal to the width.
- byte_size (number, Required): Total size of the file in bytes.
- duration_ms (number, Optional): Length of the video in milliseconds. Required for videos (max 4000); must not be provided for images.
- timezone (string, Required): The user's IANA timezone string (e.g., "Asia/Ho_Chi_Minh").
- Example:

```json
{
  "content_type": "video/mp4",
  "caption": "what is this???",
  "audience_type": "selected",
  "viewer_ids": "123e4567-e89b-12d3-a456-426614174000,987f6543-e21b-34c4-b567-513314175000",
  "width": 1080,
  "height": 1080,
  "byte_size": 8388608,
  "duration_ms": 3200,
  "timezone": "Asia/Ho_Chi_Minh"
}
```

### Responses:

- [200 OK] - Upload session initiated.

```json
{
  "post_id": "018f9e...",
  "object_key": "posts/018f9e....mp4",
  "upload_url": "https://s3.amazonaws.com/bucket/posts/..."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_MEDIA, INVALID_DIMENSIONS, INVALID_DURATION, INVALID_AUDIENCE, CAPTION_TOO_LONG.
- [403 Forbidden] - Possible 'type' values: INVALID_AUDIENCE (One or more viewer IDs are not on your friends list).

## Finalize post upload

- Endpoint:

```
POST /posts/finalize
```

- Description: Finalizes a post upload after the client has successfully uploaded the file to the storage server using the pre-signed URL. This endpoint validates the upload ticket against Redis, updates the user's posting streak (calculating increments based on their timezone), and enqueues a background job for media processing. Returns a 202 status to indicate the post is now being processed asynchronously.
- Auth required: Yes

### Request body (application/json):

- post_id (string, Required): The UUID of the post generated during the initiation step.
- object_key (string, Required): The S3 object key where the file was uploaded.
- Example:

```json
{
  "post_id": "018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a",
  "object_key": "posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a.mp4"
}
```

### Responses:

- [202 Accepted] - Post upload queued for processing.

```json
{
  "message": "Post upload queued for processing.",
  "post_id": "018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a",
  "status": "processing"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (You are not authorized to finalize this post).
- [410 Gone] - Possible 'type' values: TICKET_EXPIRED (Upload session expired or invalid).

## Check upload statuses

- Endpoint:

```
GET /posts/statuses
```

- Description: Retrieves the current lifecycle status of one or more post uploads for the authenticated user. It checks across three layers: active database records (COMPLETED), background processing jobs (PROCESSING/FAILED), and active upload tickets (UPLOADING). To maintain performance, the request is capped at 20 IDs per call.
- Auth required: Yes

### Request parameters:

- ids (string, Optional): A comma-separated list of post UUIDs to check.
- Example:

```text
GET /posts/statuses?ids=018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a,018f9e7b-9e7b-4e7b-8e7b-9e7b9e7b9e7b
```

### Request body:

- None

### Responses:

- [200 OK] - Statuses retrieved successfully.

```json
{
  "statuses": {
    "018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a": "COMPLETED",
    "018f9e7b-9e7b-4e7b-8e7b-9e7b9e7b9e7b": "PROCESSING"
  }
}
```

### Status definitions:

- **UPLOADING**: The upload session was initiated, but the user has not yet called the finalize endpoint.
- **PROCESSING**: The post was finalized and is currently in the background queue for optimization or storage.
- **COMPLETED**: The post is fully processed and is now visible on the user's profile and feed.
- **FAILED**: The background processing encountered an error and the post was not created.
- **NOT_FOUND**: The ID was not found, the upload ticket has expired (after 10 minutes), or the post belongs to a different user.

## Delete a post

- Endpoint:

```
DELETE /posts/:postId
```

- Description: Deletes a specific post and its associated media. This operation is restricted to the original author of the post. Upon successful deletion from the database, the system asynchronously removes the primary media file and its thumbnail from the storage server.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post to delete (passed as a path parameter).
- Example:

```text
DELETE /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a
```

### Request body:

- None

### Responses:

- [200 OK] - Post deleted successfully.

```json
{
  "message": "Post deleted successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (You are not authorized to delete this post).
- [404 Not Found] - Possible 'type' values: POST_NOT_FOUND.

## Send a reaction to a post

- Endpoint:

```
POST /posts/:postId/reactions
```

- Description: Sends an emoji reaction to a specific post. The operation includes optional support for a short note. It validates that the post is visible to the user, ensuring no blocking relationship exists and that the user is not reacting to their own post. A background job is automatically queued to notify the post owner of the new reaction.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post to react to (passed as a path parameter).
- Example:

```text
POST /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a/reactions
```

### Request body (application/json):

- emoji (string, Required): A single valid emoji character for the reaction.
- note (string, Optional): A short text note accompanying the reaction. Maximum 20 characters.
- Example:

```json
{
  "emoji": "🔥",
  "note": "Oach vcl!"
}
```

### Responses:

- [201 Created] - Reaction sent successfully.

```json
{
  "message": "Reaction sent successfully.",
  "reaction": {
    "id": "018f9e...",
    "post_id": "018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a",
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "emoji": "🔥",
    "note": "Oach vcl!",
    "created_at": "2026-04-08T20:10:31.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_EMOJI, INVALID_NOTE.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (Reacting to own post or lacks visibility).
- [404 Not Found] - Possible 'type' values: POST_NOT_FOUND.

## Delete a reaction of a post

- Endpoint:

```
DELETE /posts/:postId/reactions/:reactionId
```

- Description: Deletes a specific emoji reaction from a post. This operation is restricted; a user can only delete a reaction that they originally created. The system validates that the provided Reaction ID, Post ID, and User ID all correspond to the existing record before proceeding with the deletion.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post containing the reaction (passed as a path parameter).
- reactionId (string, Required): The UUID of the specific reaction to be removed (passed as a path parameter).
- Example:

```text
DELETE /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a/reactions/018f9e7b-9e7b-4e7b-8e7b-9e7b9e7b9e7b
```

### Request body:

- None

### Responses:

- [200 OK] - Reaction deleted successfully.

```json
{
  "message": "Reaction deleted successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [404 Not Found] - Possible 'type' values: REACTION_NOT_FOUND (Reaction does not exist, ID is malformed, or user is not authorized to delete it).

## View the reactions of a post

- Endpoint:

```
GET /posts/:postId/reactions
```

- Description: Retrieves a paginated list of reactions for a specific post. This view is restricted exclusively to the original author of the post. The system automatically filters out reactions from users who have a blocking relationship with the author and applies custom nicknames set by the author for each reactor.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post (passed as a path parameter).
- limit (number, Optional): The maximum number of reactions to return. Max is 100. Defaults to 20 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches reactions created before this timestamp (passed as a query parameter).
- Example:

```text
GET /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a/reactions?limit=20&cursor=2026-04-08T12:45:10.000Z
```

### Request body:

- None

### Responses:

- [200 OK] - Reactions retrieved successfully.

```json
{
  "items": [
    {
      "id": "018f9e...",
      "emoji": "🔥",
      "note": "Oach vcl!",
      "created_at": "2026-04-08T20:10:31.000Z",
      "user": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "username": "johndoe",
        "display_name": "Dôn",
        "avatar_key": "avatars/018fa1..."
      }
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_CURSOR.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (Author only or post doesn't exist).
- [404 Not Found] - Possible 'type' values: POST_NOT_FOUND.

## Mark post as viewed

- Endpoint:

```
POST /posts/:postId/views
```

- Description: Records a view for a specific post by the authenticated user. This is used to track engagement rather than fetching post details. The operation is idempotent; multiple requests by the same user for the same post will only result in a single recorded view. Views are not recorded if the authenticated user is the author of the post. The system validates that the post is visible to the user and that no blocking relationship exists.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post to mark as viewed (passed as a path parameter).
- Example:

```text
POST /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a/views
```

### Request body:

- None

### Responses:

- [200 OK] - Post view recorded successfully.

```json
{
  "message": "Post view recorded successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (User lacks visibility permissions).
- [404 Not Found] - Possible 'type' values: POST_NOT_FOUND (Post does not exist or a blocking relationship exists).

## Get the viewers of a post

- Endpoint:

```
GET /posts/:postId/viewers
```

- Description: Retrieves a paginated list of users who have viewed a specific post. Access to this information is restricted exclusively to the original author of the post. The results automatically exclude any users who have a blocking relationship with the author, and each viewer's `display_name` resolves in priority order: custom nickname, display name, username.
- Auth required: Yes

### Request parameters:

- postId (string, Required): The UUID of the post (passed as a path parameter).
- limit (string, Optional): The maximum number of viewers to return. Max is 50. Defaults to 20 (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches viewers who viewed the post before this timestamp (passed as a query parameter).
- Example:

```text
GET /posts/018f9e7a-9e7a-4e7a-8e7a-9e7a9e7a9e7a/viewers?limit=20&cursor=2026-04-08T12:45:10.000Z
```

### Request body:

- None

### Responses:

- [200 OK] - Viewers retrieved successfully.

```json
{
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "username": "janesmith",
      "display_name": "Jane Smith",
      "avatar_key": "avatars/018fa1...",
      "viewed_at": "2026-04-08T12:45:10.000Z"
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z"
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_CURSOR.
- [403 Forbidden] - Possible 'type' values: UNAUTHORIZED (Only the author can view post viewers).
- [404 Not Found] - Possible 'type' values: POST_NOT_FOUND.

# User Endpoints:

## Update user profile

- Endpoint:

```
PATCH /users/me
```

- Description: Updates the authenticated user's profile information. This endpoint handles multipart/form-data to support file uploads for avatars. It supports updating the email and display name, as well as explicitly removing the avatar or display name. Upon success, old avatar files are cleaned up from storage and a real-time WebSocket update is broadcasted to the user and all their friends to ensure UI consistency across the network.
- Auth required: Yes

### Request body (multipart/form-data):

- email (string, Optional): A new valid email address for the account.
- display_name (string, Optional): A new display name.
- avatar (file, Optional): An image file (JPEG, PNG, WebP, GIF, AVIF, HEIF/HEIC) to be used as the new profile picture.
- remove_display_name (string, Optional): Set to "true" to clear the current display name.
- remove_avatar (string, Optional): Set to "true" to delete the current avatar and revert to default.
- Example:

```json
{
  "email": "newemail@example.com",
  "display_name": "John Doe",
  "remove_avatar": "false"
}
```

### Responses:

- [200 OK] - Profile updated successfully.

```json
{
  "message": "Profile updated successfully.",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "username": "johndoe",
    "email": "newemail@example.com",
    "display_name": "John Doe",
    "avatar_url": "https://s3.amazonaws.com/bucket/avatars/123e4567...jpeg",
    "updated_at": "2026-04-08T20:15:05.000Z"
  }
}
```

- [400 Bad Request] - Possible 'type' values: INVALID_EMAIL, STORAGE_ERROR (Invalid image format).
- [404 Not Found] - Possible 'type' values: MISSING_USER.
- [409 Conflict] - Possible 'type' values: EMAIL_TAKEN.
- [502 Bad Gateway] - Possible 'type' values: STORAGE_ERROR (Failed to upload to S3).

## Delete account

- Endpoint:

```
DELETE /users/me
```

- Description: Permanently deletes the authenticated user's account and all associated data after verifying the user's password. This is a destructive operation that removes the user's record from the database and triggers a cleanup of all storage assets, including the user's avatar and all media/thumbnails associated with their posts.
- Auth required: Yes

### Request parameters:

- None
- Example:

```text
DELETE /users/me
```

### Request body:

```json
{
  "password": "userpassword"
}
```

### Responses:

- [200 OK] - Account deleted successfully.

```json
{
  "message": "Account deleted successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_PASSWORD.
- [401 Unauthorized] - Possible 'type' values: INVALID_CREDENTIALS, LINKED_THIRD_PARTY_ACCOUNT.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.

## Register a device

- Endpoint:

```
POST /users/me/devices
```

- Description: Registers a mobile device for receiving push notifications or updates the user association for an existing device token. The system supports 'android' and 'ios' platforms. If the device token is already registered, the record is updated with the current user's ID and platform to ensure notifications are routed correctly.
- Auth required: Yes

### Request body (application/json):

- device_token (string, Required): The unique registration token provided by FCM (Android) or APNs (iOS).
- platform (string, Required): The operating system of the device. Must be either "android" or "ios".
- Example:

```json
{
  "device_token": "fcm_token_1234567890",
  "platform": "ios"
}
```

### Responses:

- [200 OK] - Device registered successfully.

```json
{
  "message": "Device registered successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, INVALID_PLATFORM.

## Get user's public profile

- Endpoint:

```
GET /users/public/:username
```

- Description: Retrieves the public profile of a user by their username. The response includes the user's ID, username, and a resolved URL for their avatar. If the authenticated user has assigned a custom nickname to the target user, that nickname will be returned as the `displayName`. To protect user privacy, a 404 error is returned if the target user has blocked the requester or if the account does not exist.
- Auth required: Yes

### Request parameters:

- username (string, Required): The username of the user whose profile is being requested (passed as a path parameter).
- Example:

```text
GET /users/public/janesmith
```

### Request body:

- None

### Responses:

- [200 OK] - Profile retrieved successfully.

```json
{
  "profile": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "username": "janesmith",
    "displayName": "Jane (Bestie)",
    "avatarUrl": "https://s3.amazonaws.com/bucket/avatars/123e4567...jpeg"
  }
}
```

- [400 Bad Request] - Possible 'type' values: INVALID_INPUT.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.

## Update user password

- Endpoint:

```
PATCH /users/password
```

- Description: Updates the authenticated user's password. The process requires verification of the current password and validates that the new password meets the minimum length requirement (6 characters). For security, all other active sessions for the user are terminated immediately upon a successful password change, though the current session remains active.
- Auth required: Yes

### Request parameters:

- None

### Request body (application/json):

- old_password (string, Required): The user's current password.
- new_password (string, Required): The new password to set (minimum 6 characters).
- Example:

```json
{
  "old_password": "CurrentPassword123!",
  "new_password": "NewPassword456!"
}
```

### Responses:

- [200 OK] - Password updated successfully.

```json
{
  "message": "Password updated successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_OLD_PASSWORD, MISSING_NEW_PASSWORD, WEAK_PASSWORD, PASSWORD_NOT_SET (if the account is OAuth-only).
- [401 Unauthorized] - Possible 'type' values: INVALID_OLD_PASSWORD.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.

## Block a user

- Endpoint:

```
POST /users/:targetId/block
```

- Description: Blocks a specified user. If a mutual friendship exists, it is immediately terminated, and all custom nicknames between the two users are deleted. Real-time WebSocket updates are sent to both parties to reflect the friendship status change. Once blocked, the target user will no longer be able to find the blocker's profile or interact with their content.
- Auth required: Yes

### Request parameters:

- targetId (string, Required): The UUID of the user to block (passed as a path parameter).
- Example:

```text
POST /users/987f6543-e21b-34c4-b567-513314175000/block
```

### Request body:

- None

### Responses:

- [200 OK] - User blocked successfully.

```json
{
  "message": "User blocked successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, CANNOT_BLOCK_SELF.
- [404 Not Found] - Possible 'type' values: USER_NOT_FOUND.
- [409 Conflict] - Possible 'type' values: ALREADY_BLOCKED.

## Unblock a user

- Endpoint:

```text
DELETE /users/:targetId/block
```

- Description: Removes an existing block relationship created by the authenticated user for a specified target user.
- Auth required: Yes

### Request parameters:

- targetId (string, Required): The UUID of the user to unblock (passed as a path parameter).
- Example:

```text
DELETE /users/987f6543-e21b-34c4-b567-513314175000/block
```

### Request body:

- None

### Responses:

- [200 OK] - User unblocked successfully.

```json
{
  "message": "User unblocked successfully."
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_INPUT, CANNOT_UNBLOCK_SELF.
- [404 Not Found] - Possible 'type' values: NOT_BLOCKED.

## View blocked users

- Endpoint:

```text
GET /users/me/blocked
```

- Description: Retrieves a paginated list of users that the authenticated user has blocked. Supports sorting by date and cursor-based pagination using the creation timestamp.
- Auth required: Yes

### Request parameters:

- limit (string, Optional): The maximum number of blocked users to return. Max is 100. Defaults to 20 (passed as a query parameter).
- sort (string, Optional): Sorts the results by when the block was created. Valid values are 'newest' or 'oldest'. Defaults to 'newest' (passed as a query parameter).
- cursor (string, Optional): An ISO date string used for pagination. Fetches block records created before or after this timestamp depending on the sort order (passed as a query parameter).
- Example:

```text
GET /users/me/blocked?limit=20&sort=newest
```

### Request body:

- None

### Responses:

- [200 OK] - Blocked users retrieved successfully.

```json
{
  "items": [
    {
      "id": "987f6543-e21b-34c4-b567-513314175000",
      "username": "johndoe",
      "display_name": "John Doe",
      "avatar_key": "avatars/018fa1...",
      "blocked_at": "2026-04-08T12:51:43.000Z"
    }
  ],
  "next_cursor": "2026-04-07T09:15:00.000Z",
  "limit": 20
}
```

- [400 Bad Request] - Possible 'type' values: MISSING_USER_ID, INVALID_CURSOR, INVALID_LIMIT, INVALID_SORT.

## Get current user's streak

- Endpoint:

```
GET /users/me/streak
```

- Description: Retrieves the posting streak statistics for the authenticated user. The system calculates whether the streak is currently "alive" (meaning the user has posted within the last 24–48 hours depending on their local calendar day) and whether they have already fulfilled their posting requirement for the current day. Calculations are performed dynamically based on the provided IANA timezone.
- Auth required: Yes

### Request parameters:

- timezone (string, Required): The user's IANA timezone string (e.g., "America/New_York") used to calculate local calendar days (passed as a query parameter).
- Example:

```text
GET /users/me/streak?timezone=Asia/Ho_Chi_Minh
```

### Request body:

- None

### Responses:

- [200 OK] - Streak statistics retrieved successfully.

```json
{
  "currentStreak": 5,
  "longestStreak": 14,
  "lastPostDate": "2026-04-07T18:30:00.000Z",
  "isAlive": true,
  "postedToday": false
}
```

- [400 Bad Request] - Provided when the user ID is invalid, the timezone is missing, or the timezone format is unrecognized.

### Field definitions:

- **currentStreak**: The number of consecutive days the user has posted. Reverts to 0 if `isAlive` becomes false.
- **longestStreak**: The all-time highest streak record for this user.
- **lastPostDate**: The ISO timestamp of the user's most recent post.
- **isAlive**: A boolean indicating if the streak is still active. Returns `true` if the user posted today or yesterday in their local time.
- **postedToday**: A boolean indicating if the user has already posted during the current calendar day in their local time.
