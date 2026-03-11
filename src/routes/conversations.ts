import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/require_auth.ts";
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

const conversationsRouter = new Hono<{ Variables: AuthVariables }>();

// Create a conversation
conversationsRouter.post("/conversations", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const body = await c.req.json();
    const targetUserId = body.target_user_id;

    if (!targetUserId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Target user ID is required." } },
        400,
      );
    }

    const result = await createConversation(userId, targetUserId);

    return c.json(
      {
        message: "Conversation created.",
        conversation: {
          id: result.id,
          user_low: result.userLow,
          user_high: result.userHigh,
          created_at: result.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof CreateConversationError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    if (error instanceof SyntaxError) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Invalid JSON body." } }, 400);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Send a message / reply a post
conversationsRouter.post("/conversations/:conversationId/messages", requireAuth, async (c) => {
  try {
    const senderId = c.get("authUserId");
    const conversationId = c.req.param("conversationId");
    const body = await c.req.json();

    if (!conversationId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Conversation ID is required." } },
        400,
      );
    }

    const result = await sendMessage({
      senderId,
      conversationId,
      content: body.content,
      referencedPostId: body.referenced_post_id,
    });

    return c.json(
      {
        message: "Message sent successfully.",
        data: {
          id: result.id,
          conversation_id: result.conversationId,
          sender_id: result.senderId,
          content: result.content,
          referenced_post_id: result.referencedPostId,
          created_at: result.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof SendMessageError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    if (error instanceof SyntaxError) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Invalid JSON body." } }, 400);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Get a conversation's messages
conversationsRouter.get("/conversations/:conversationId/messages", requireAuth, async (c) => {
  try {
    const viewerId = c.get("authUserId");
    const conversationId = c.req.param("conversationId");

    if (!conversationId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Conversation ID is required." } },
        400,
      );
    }

    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50;
    const cursor = c.req.query("cursor");

    const result = await viewConversationMessages(viewerId, conversationId, limit, cursor);

    return c.json(
      {
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
      },
      200,
    );
  } catch (error) {
    if (error instanceof ViewConversationMessagesError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Get all conversations with pagination
conversationsRouter.get("/conversations", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");

    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : 50;
    const cursor = c.req.query("cursor");

    const result = await getConversations(userId, limit, cursor);

    return c.json(
      {
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
      },
      200,
    );
  } catch (error) {
    if (error instanceof GetConversationsError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Clear a conversation (for the clearer's side)
conversationsRouter.delete("/conversations/:conversationId", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const conversationId = c.req.param("conversationId");

    if (!conversationId) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "Conversation ID is required." } },
        400,
      );
    }

    await clearConversation(userId, conversationId);

    return c.json({ message: "Conversation cleared successfully." }, 200);
  } catch (error) {
    if (error instanceof ClearConversationError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// React a message
conversationsRouter.post("/messages/:messageId/reactions", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const messageId = c.req.param("messageId");
    const body = await c.req.json();

    if (!messageId) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Message ID is required." } }, 400);
    }

    const result = await reactMessage({
      userId,
      messageId,
      emoji: body.emoji,
    });

    return c.json(
      {
        message: "Reaction recorded successfully.",
        data: {
          id: result.id,
          message_id: result.messageId,
          user_id: result.userId,
          emoji: result.emoji,
          created_at: result.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof ReactMessageError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    if (error instanceof SyntaxError) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Invalid JSON body." } }, 400);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Remove a message's reaction
conversationsRouter.delete("/messages/:messageId/reactions", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const messageId = c.req.param("messageId");

    if (!messageId) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Message ID is required." } }, 400);
    }

    await removeMessageReaction(userId, messageId);

    return c.json({ message: "Reaction removed successfully." }, 200);
  } catch (error) {
    if (error instanceof RemoveMessageReactionError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

// Update an existing message reaction
conversationsRouter.patch("/messages/:messageId/reactions", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const messageId = c.req.param("messageId");
    const body = await c.req.json();

    if (!messageId) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Message ID is required." } }, 400);
    }

    const result = await updateMessageReaction({
      userId,
      messageId,
      emoji: body.emoji,
    });

    return c.json(
      {
        message: "Reaction updated successfully.",
        data: {
          id: result.id,
          message_id: result.messageId,
          user_id: result.userId,
          emoji: result.emoji,
          created_at: result.createdAt,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof UpdateMessageReactionError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    if (error instanceof SyntaxError) {
      return c.json({ error: { type: "MISSING_INPUT", message: "Invalid JSON body." } }, 400);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

export default conversationsRouter;
