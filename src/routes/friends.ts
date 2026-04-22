import { Elysia, t } from "elysia";
import {
  acceptFriendRequest,
  AcceptFriendRequestError,
} from "../usecases/friends/accept_friend_request.ts";
import {
  cancelOrRejectFriendRequest,
  CancelOrRejectFriendRequestError,
} from "../usecases/friends/cancel_or_reject_friend_request.ts";
import {
  sendFriendRequest,
  SendFriendRequestError,
} from "../usecases/friends/send_friend_request.ts";
import { unfriend, UnfriendError } from "../usecases/friends/unfriend.ts";
import {
  viewFriendRequests,
  ViewFriendRequestsError,
} from "../usecases/friends/view_friend_requests.ts";
import { viewFriends, ViewFriendsError } from "../usecases/friends/view_friends.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { requireAuth } from "./middleware/require_auth.ts";

const protectedFriendsRouter = new Elysia()
  .use(requireAuth)

  // Send a friend request
  .post(
    "/friend-requests",
    async ({ body, authUserId, set }) => {
      const result = await sendFriendRequest(authUserId, body.identifier);

      set.status = 201;
      return {
        message: `Friend request to ${body.identifier} sent successfully.`,
        friend_request: {
          id: result.id,
          requester_id: result.requesterId,
          receiver_id: result.receiverId,
          created_at: result.createdAt,
        },
      };
    },
    {
      body: t.Object({
        identifier: t.String(),
      }),
    },
  )

  // View current user's friend requests
  .get(
    "/friend-requests",
    async ({ authUserId, query, set }) => {
      const limit = Number(query.limit) || 20;
      const direction = query.direction;
      const sort = (query.sort as "newest" | "oldest" | undefined) || "newest";
      const result = await viewFriendRequests(authUserId, query.cursor, limit, direction, sort);

      set.status = 200;
      return {
        items: result.items.map((item) => ({
          id: item.id,
          created_at: item.createdAt,
          direction: item.direction,
          requester: {
            id: item.requester.id,
            username: item.requester.username,
            email: item.requester.email,
            display_name: item.requester.displayName,
            avatar_url: item.requester.avatarUrl,
          },
          receiver: {
            id: item.receiver.id,
            username: item.receiver.username,
            email: item.receiver.email,
            display_name: item.receiver.displayName,
            avatar_url: item.receiver.avatarUrl,
          },
        })),
        next_cursor: result.nextCursor,
        limit: result.limit,
        direction: result.direction,
      };
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        direction: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
    },
  )

  // Accept a friend request
  .patch(
    "/friend-requests/:requestId",
    async ({ authUserId, params, set }) => {
      const result = await acceptFriendRequest(authUserId, params.requestId);

      set.status = 200;
      return {
        message: "Friend request accepted successfully.",
        friend_request: {
          id: result.id,
          requester_id: result.requesterId,
          receiver_id: result.receiverId,
          created_at: result.createdAt,
        },
      };
    },
    {
      params: t.Object({
        requestId: t.String(),
      }),
    },
  )

  // Cancel or reject a friend request
  .delete(
    "/friend-requests/:requestId",
    async ({ authUserId, params, set }) => {
      await cancelOrRejectFriendRequest(authUserId, params.requestId);

      set.status = 200;
      return {
        message: "Friend request canceled or rejected successfully.",
      };
    },
    {
      params: t.Object({
        requestId: t.String(),
      }),
    },
  )

  // Unfriend a fake friend
  .delete(
    "/friendships/:friendId",
    async ({ authUserId, params, set }) => {
      await unfriend(authUserId, params.friendId);

      set.status = 200;
      return {
        message: "Unfriended successfully.",
      };
    },
    {
      params: t.Object({
        friendId: t.String(),
      }),
    },
  )

  // View friend list
  .get(
    "/friends",
    async ({ authUserId, query, set }) => {
      const limit = query.limit ? Number(query.limit) : 20;
      const sort = (query.sort as "newest" | "oldest" | undefined) || "newest";
      const cursor = query.cursor;

      const result = await viewFriends(authUserId, cursor, limit, sort);

      set.status = 200;
      return {
        items: result.items.map((friend) => ({
          id: friend.id,
          username: friend.username,
          display_name: friend.displayName,
          avatar_url: friend.avatarUrl,
          created_at: friend.createdAt,
        })),
        next_cursor: result.nextCursor,
        limit: result.limit,
      };
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
    },
  );

const friendsRouter = withApiErrorHandler(new Elysia(), {
  SendFriendRequestError,
  ViewFriendRequestsError,
  AcceptFriendRequestError,
  CancelOrRejectFriendRequestError,
  UnfriendError,
  ViewFriendsError,
}).use(protectedFriendsRouter);

export default friendsRouter;
