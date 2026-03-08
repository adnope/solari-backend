import { Hono } from "@hono/hono";
import { AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import {
  sendFriendRequest,
  SendFriendRequestError,
} from "../usecases/friends/send_friend_request.ts";
import {
  viewFriendRequests,
  ViewFriendRequestsError,
} from "../usecases/friends/view_friend_requests.ts";
import {
  acceptFriendRequest,
  AcceptFriendRequestError,
} from "../usecases/friends/accept_friend_request.ts";
import { unfriend, UnfriendError } from "../usecases/friends/unfriend.ts";
import { viewFriends, ViewFriendsError } from "../usecases/friends/view_friends.ts";
import {
  cancelOrRejectFriendRequest,
  CancelOrRejectFriendRequestError,
} from "../usecases/friends/cancel_or_reject_friend_request.ts";

const friendsRouter = new Hono<{
  Variables: AuthVariables;
}>();

// Send a friend request
friendsRouter.post("/friend-requests", requireAuth, async (c) => {
  try {
    const requesterId = c.get("authUserId");

    const body = await c.req.json<{
      identifier: string;
    }>();

    const result = await sendFriendRequest(requesterId, body.identifier);

    return c.json(
      {
        message: `Friend request to ${body.identifier} sent successfully.`,
        friend_request: {
          id: result.id,
          requester_id: result.requesterId,
          receiver_id: result.receiverId,
          created_at: result.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json(
        {
          error: {
            type: "INVALID_JSON",
            message: "Invalid JSON body.",
          },
        },
        400,
      );
    }

    if (error instanceof SendFriendRequestError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: {
            type: "INTERNAL_ERROR",
            message: error.message,
          },
        },
        500,
      );
    }

    return c.json(
      {
        error: {
          type: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      },
      500,
    );
  }
});

// View current user's friend requests
friendsRouter.get("/friend-requests", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");

    const offset = c.req.query("offset") ? Number(c.req.query("offset")) : 0;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 20;
    const direction = c.req.query("direction") ?? "both";

    const result = await viewFriendRequests(userId, offset, limit, direction);

    return c.json(
      {
        items: result.items.map((item) => ({
          id: item.id,
          created_at: item.createdAt,
          direction: item.direction,
          requester: {
            id: item.requester.id,
            username: item.requester.username,
            email: item.requester.email,
            display_name: item.requester.displayName,
            avatar_key: item.requester.avatarKey,
          },
          receiver: {
            id: item.receiver.id,
            username: item.receiver.username,
            email: item.receiver.email,
            display_name: item.receiver.displayName,
            avatar_key: item.receiver.avatarKey,
          },
        })),
        offset: result.offset,
        limit: result.limit,
        direction: result.direction,
      },
      200,
    );
  } catch (error) {
    if (error instanceof ViewFriendRequestsError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: {
            type: "INTERNAL_ERROR",
            message: error.message,
          },
        },
        500,
      );
    }

    return c.json(
      {
        error: {
          type: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      },
      500,
    );
  }
});

// Accept a friend request
friendsRouter.patch("/friend-requests/:requestId", requireAuth, async (c) => {
  try {
    const receiverId = c.get("authUserId");
    const requestId = c.req.param("requestId");

    if (!requestId) {
      return c.json(
        {
          error: {
            type: "MISSING_INPUT",
            message: "Request ID is required.",
          },
        },
        400,
      );
    }

    const result = await acceptFriendRequest(receiverId, requestId);

    return c.json(
      {
        message: "Friend request accepted successfully.",
        friend_request: {
          id: result.id,
          requester_id: result.requesterId,
          receiver_id: result.receiverId,
          created_at: result.createdAt,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof AcceptFriendRequestError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: {
            type: "INTERNAL_ERROR",
            message: error.message,
          },
        },
        400,
      );
    }

    return c.json(
      {
        error: {
          type: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      },
      500,
    );
  }
});

// Cancel or reject a friend request (depending on requester/receiver)
friendsRouter.delete("/friend-requests/:requestId", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const requestId = c.req.param("requestId");

    if (!requestId) {
      return c.json({ error: "Request ID is required." }, 400);
    }

    await cancelOrRejectFriendRequest(userId, requestId);

    return c.json(
      {
        message: "Friend request canceled or rejected successfully.",
      },
      200,
    );
  } catch (error) {
    if (error instanceof CancelOrRejectFriendRequestError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal server error." }, 500);
  }
});

// Unfriend a user
friendsRouter.delete("/friendships/:friendId", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const friendId = c.req.param("friendId");

    if (!friendId) {
      return c.json({ error: "User ID is required." }, 400);
    }

    await unfriend(userId, friendId);

    return c.json(
      {
        message: "Unfriended successfully.",
      },
      200,
    );
  } catch (error) {
    if (error instanceof UnfriendError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal server error." }, 500);
  }
});

// Get list of friends for the logged-in user
friendsRouter.get("/friends", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");

    const offset = c.req.query("offset") ? Number(c.req.query("offset")) : 0;
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 20;

    const result = await viewFriends(userId, offset, limit);

    return c.json(
      {
        items: result.items.map((friend) => ({
          id: friend.id,
          username: friend.username,
          display_name: friend.displayName,
          avatar_key: friend.avatarKey,
        })),
        offset: result.offset,
        limit: result.limit,
      },
      200,
    );
  } catch (error) {
    if (error instanceof ViewFriendsError) {
      return c.json(
        {
          error: {
            type: error.type,
            message: error.message,
          },
        },
        error.statusCode,
      );
    }

    if (error instanceof Error) {
      return c.json(
        {
          error: {
            type: "INTERNAL_ERROR",
            message: error.message,
          },
        },
        400,
      );
    }

    return c.json(
      {
        error: {
          type: "INTERNAL_ERROR",
          message: "Internal server error.",
        },
      },
      500,
    );
  }
});

export default friendsRouter;
