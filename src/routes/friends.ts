import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
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
import { withApiErrorHandler } from "./api_error_handler.ts";

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
      const limit = query.limit === undefined || query.limit === "" ? 20 : Number(query.limit);
      const result = await viewFriendRequests(authUserId, query.offset, limit, query.direction);

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
      };
    },
    {
      query: t.Object({
        offset: t.Optional(t.Numeric({ default: 0 })),
        limit: t.Optional(t.Union([t.Numeric(), t.Literal("")])),
        direction: t.Optional(
          t.Union([t.Literal("incoming"), t.Literal("outgoing"), t.Literal("both")], {
            default: "both",
          }),
        ),
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
      const offset = Number(query.offset) || 0;
      const limit = Number(query.limit) || 50;
      const result = await viewFriends(authUserId, offset, limit);

      set.status = 200;
      return {
        items: result.items.map((friend) => ({
          id: friend.id,
          username: friend.username,
          display_name: friend.displayName,
          avatar_key: friend.avatarKey,
        })),
        offset: result.offset,
        limit: result.limit,
      };
    },
    {
      query: t.Object({
        offset: t.Optional(t.String()),
        limit: t.Optional(t.String()),
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
