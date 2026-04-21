import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { deleteAccount, DeleteAccountError } from "../usecases/users/delete_account.ts";
import { getPublicProfile, GetPublicProfileError } from "../usecases/users/get_public_profile.ts";
import { registerDevice, RegisterDeviceError } from "../usecases/users/register_device.ts";
import { updateProfile, UpdateProfileError } from "../usecases/users/update_profile.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { updatePassword, UpdatePasswordError } from "../usecases/auth/update_password.ts";
import { blockUser } from "../usecases/users/block_user.ts";
import { getUserStreak } from "../usecases/users/get_user_streak.ts";
import { viewBlockedUsers, ViewBlockedUsersError } from "../usecases/users/view_blocked_users.ts";
import { unblockUser, UnblockUserError } from "../usecases/users/unblock_user.ts";

const protectedUsersRouter = new Elysia()
  .use(requireAuth)

  // Update user profile
  .patch(
    "/users/me",
    async ({ authUserId, body, set }) => {
      const email = body.email ?? "";
      const displayName = body.display_name ?? "";

      const removeDisplayName = body.remove_display_name === "true";
      const removeAvatar = body.remove_avatar === "true";

      let avatar: { buffer: Uint8Array; contentType: string } | undefined = undefined;

      if (body.avatar) {
        avatar = {
          buffer: new Uint8Array(await body.avatar.arrayBuffer()),
          contentType: body.avatar.type,
        };
      }

      const result = await updateProfile({
        userId: authUserId,
        email,
        displayName,
        removeDisplayName,
        removeAvatar,
        avatar,
      });

      set.status = 200;
      return {
        message: "Profile updated successfully.",
        user: {
          id: result.id,
          username: result.username,
          email: result.email,
          display_name: result.display_name,
          avatar_key: result.avatar_key,
          updated_at: result.updated_at,
        },
      };
    },
    {
      parse: "formdata",
      body: t.Object({
        email: t.Optional(t.String()),
        display_name: t.Optional(t.String()),
        remove_display_name: t.Optional(t.String()),
        remove_avatar: t.Optional(t.String()),
        avatar: t.Optional(t.File()),
      }),
    },
  )

  // Delete account
  .delete(
    "/users/me",
    async ({ authUserId, body, set }) => {
      await deleteAccount({
        userId: authUserId,
        password: body?.password ?? "",
      });

      set.status = 200;
      return {
        message: "Account deleted successfully.",
      };
    },
    {
      body: t.Object({
        password: t.String(),
      }),
    },
  )

  // Register a device for push notifications
  .post(
    "/users/me/devices",
    async ({ authUserId, body, set }) => {
      await registerDevice({
        userId: authUserId,
        deviceToken: body.device_token,
        platform: body.platform,
      });

      set.status = 200;
      return {
        message: "Device registered successfully.",
      };
    },
    {
      body: t.Object({
        device_token: t.String(),
        platform: t.String(),
      }),
    },
  )

  // Get user's public profile
  .get(
    "/users/public/:username",
    async ({ authUserId, params, set }) => {
      const profile = await getPublicProfile(authUserId, params.username);

      set.status = 200;
      return {
        profile,
      };
    },
    {
      params: t.Object({
        username: t.String(),
      }),
    },
  )

  // Update a user's password
  .patch(
    "/users/password",
    async ({ authUserId, authSessionId, body, set }) => {
      await updatePassword({
        userId: authUserId,
        currentSessionId: authSessionId,
        oldPassword: body.old_password,
        newPassword: body.new_password,
      });

      set.status = 200;
      return {
        message: "Password updated successfully.",
      };
    },
    {
      body: t.Object({
        old_password: t.String(),
        new_password: t.String(),
      }),
    },
  )

  // Block a user
  .post(
    "/users/:targetId/block",
    async ({ authUserId, params, set }) => {
      await blockUser(authUserId, params.targetId);

      set.status = 200;
      return {
        message: "User blocked successfully.",
      };
    },
    {
      params: t.Object({
        targetId: t.String(),
      }),
    },
  )

  // Unblock a user
  .delete(
    "/users/:targetId/block",
    async ({ authUserId, params, set }) => {
      await unblockUser(authUserId, params.targetId);

      set.status = 200;
      return {
        message: "User unblocked successfully.",
      };
    },
    {
      params: t.Object({
        targetId: t.String(),
      }),
    },
  )

  // View blocked users
  .get(
    "/users/me/blocked",
    async ({ authUserId, query, set }) => {
      const limit = query.limit ? Number(query.limit) : 20;
      const sort = (query.sort as "newest" | "oldest" | undefined) || "newest";
      const cursor = query.cursor;

      const result = await viewBlockedUsers(authUserId, cursor, limit, sort);

      set.status = 200;
      return {
        items: result.items.map((blockedUser) => ({
          id: blockedUser.id,
          username: blockedUser.username,
          display_name: blockedUser.displayName,
          avatar_key: blockedUser.avatarKey,
          blocked_at: blockedUser.blockedAt,
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
  )

  // Get current user's streak
  .get(
    "/users/me/streak",
    async ({ authUserId, query, set }) => {
      const result = await getUserStreak({
        userId: authUserId,
        timezone: query.timezone,
      });

      set.status = 200;
      return result;
    },
    {
      query: t.Object({
        timezone: t.String({ error: "Timezone query parameter is required" }),
      }),
    },
  );

const usersRouter = withApiErrorHandler(new Elysia(), {
  UpdateProfileError,
  DeleteAccountError,
  RegisterDeviceError,
  GetPublicProfileError,
  UpdatePasswordError,
  ViewBlockedUsersError,
  UnblockUserError,
}).use(protectedUsersRouter);

export default usersRouter;
