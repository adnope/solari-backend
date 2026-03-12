import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import {
  clearConversation,
  ClearConversationError,
} from "../usecases/conversations/clear_conversation.ts";
import {
  createConversation,
  CreateConversationError,
} from "../usecases/conversations/create_conversation.ts";
import {
  getConversations,
  GetConversationsError,
} from "../usecases/conversations/get_conversations.ts";
import { reactMessage, ReactMessageError } from "../usecases/conversations/react_message.ts";
import {
  removeMessageReaction,
  RemoveMessageReactionError,
} from "../usecases/conversations/remove_message_reaction.ts";
import { sendMessage, SendMessageError } from "../usecases/conversations/send_message.ts";
import {
  updateMessageReaction,
  UpdateMessageReactionError,
} from "../usecases/conversations/update_message_reaction.ts";
import {
  viewConversationMessages,
  ViewConversationMessagesError,
} from "../usecases/conversations/view_conversation_messages.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";

const protectedConversationsRouter = new Elysia()
  .use(requireAuth)

  // Create a conversation
  .post(
    "/conversations",
    async ({ authUserId, body, set }) => {
      const result = await createConversation(authUserId, body.target_user_id);

      set.status = 201;
      return {
        message: "Conversation created.",
        conversation: {
          id: result.id,
          user_low: result.userLow,
          user_high: result.userHigh,
          created_at: result.createdAt,
        },
      };
    },
    {
      body: t.Object({
        target_user_id: t.String(),
      }),
    },
  )

  // Send a message / reply a post
  .post(
    "/conversations/:conversationId/messages",
    async ({ authUserId, params, body, set }) => {
      const result = await sendMessage({
        senderId: authUserId,
        conversationId: params.conversationId,
        content: body.content,
        referencedPostId: body.referenced_post_id,
      });

      set.status = 201;
      return {
        message: "Message sent successfully.",
        data: {
          id: result.id,
          conversation_id: result.conversationId,
          sender_id: result.senderId,
          content: result.content,
          referenced_post_id: result.referencedPostId,
          created_at: result.createdAt,
        },
      };
    },
    {
      params: t.Object({
        conversationId: t.String(),
      }),
      body: t.Object({
        content: t.String(),
        referenced_post_id: t.Optional(t.String()),
      }),
    },
  )

  // Get a conversation's messages
  .get(
    "/conversations/:conversationId/messages",
    async ({ authUserId, params, query, set }) => {
      const limit = query.limit === undefined || query.limit === "" ? 50 : Number(query.limit);
      const result = await viewConversationMessages(
        authUserId,
        params.conversationId,
        limit,
        query.cursor,
      );

      set.status = 200;
      return {
        items: result.items.map((msg) => ({
          id: msg.id,
          sender_id: msg.senderId,
          content: msg.content,
          referenced_post_id: msg.referencedPostId,
          created_at: msg.createdAt,
          reactions: msg.reactions.map((r) => ({
            user_id: r.userId,
            emoji: r.emoji,
          })),
        })),
        next_cursor: result.nextCursor,
      };
    },
    {
      params: t.Object({
        conversationId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.Union([t.Numeric(), t.Literal("")])),
        cursor: t.Optional(t.String()),
      }),
    },
  )

  // Get all conversations with pagination
  .get(
    "/conversations",
    async ({ authUserId, query, set }) => {
      const limit = query.limit === undefined || query.limit === "" ? 50 : Number(query.limit);
      const result = await getConversations(authUserId, limit, query.cursor);

      set.status = 200;
      return {
        items: result.items.map((conv) => ({
          id: conv.id,
          user_low: conv.userLow,
          user_high: conv.userHigh,
          created_at: conv.createdAt,
          updated_at: conv.updatedAt,
          partner: {
            id: conv.partner.id,
            username: conv.partner.username,
            display_name: conv.partner.displayName,
            avatar_key: conv.partner.avatarKey,
          },
        })),
        next_cursor: result.nextCursor,
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Union([t.Numeric(), t.Literal("")])),
        cursor: t.Optional(t.String()),
      }),
    },
  )

  // Clear a conversation
  .delete(
    "/conversations/:conversationId",
    async ({ authUserId, params, set }) => {
      await clearConversation(authUserId, params.conversationId);

      set.status = 200;
      return {
        message: "Conversation cleared successfully.",
      };
    },
    {
      params: t.Object({
        conversationId: t.String(),
      }),
    },
  )

  // React to a message
  .post(
    "/messages/:messageId/reactions",
    async ({ authUserId, params, body, set }) => {
      const result = await reactMessage({
        userId: authUserId,
        messageId: params.messageId,
        emoji: body.emoji,
      });

      set.status = 201;
      return {
        message: "Reaction recorded successfully.",
        data: {
          id: result.id,
          message_id: result.messageId,
          user_id: result.userId,
          emoji: result.emoji,
          created_at: result.createdAt,
        },
      };
    },
    {
      params: t.Object({
        messageId: t.String(),
      }),
      body: t.Object({
        emoji: t.String(),
      }),
    },
  )

  // Remove a message reaction
  .delete(
    "/messages/:messageId/reactions",
    async ({ authUserId, params, set }) => {
      await removeMessageReaction(authUserId, params.messageId);

      set.status = 200;
      return {
        message: "Reaction removed successfully.",
      };
    },
    {
      params: t.Object({
        messageId: t.String(),
      }),
    },
  )

  // Update an existing message reaction
  .patch(
    "/messages/:messageId/reactions",
    async ({ authUserId, params, body, set }) => {
      const result = await updateMessageReaction({
        userId: authUserId,
        messageId: params.messageId,
        emoji: body.emoji,
      });

      set.status = 200;
      return {
        message: "Reaction updated successfully.",
        data: {
          id: result.id,
          message_id: result.messageId,
          user_id: result.userId,
          emoji: result.emoji,
          created_at: result.createdAt,
        },
      };
    },
    {
      params: t.Object({
        messageId: t.String(),
      }),
      body: t.Object({
        emoji: t.String(),
      }),
    },
  );

const conversationsRouter = withApiErrorHandler(new Elysia(), {
  CreateConversationError,
  SendMessageError,
  ViewConversationMessagesError,
  GetConversationsError,
  ClearConversationError,
  ReactMessageError,
  RemoveMessageReactionError,
  UpdateMessageReactionError,
}).use(protectedConversationsRouter);

export default conversationsRouter;
