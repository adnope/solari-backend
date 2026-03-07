import { Hono } from "@hono/hono";
import { AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import {
  sendFriendRequest,
  SendFriendRequestError,
} from "../usecases/send_friend_requests.ts";
import {
  viewFriendRequests,
  ViewFriendRequestsError,
} from "../usecases/view_friend_requests.ts";

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
        friendRequest: result,
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

    return c.json(result, 200);
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

export default friendsRouter;
