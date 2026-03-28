import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { deleteAccount, DeleteAccountError } from "../usecases/users/delete_account.ts";
import { getPublicProfile, GetPublicProfileError } from "../usecases/users/get_public_profile.ts";
import { registerDevice, RegisterDeviceError } from "../usecases/users/register_device.ts";
import { updateProfile, UpdateProfileError } from "../usecases/users/update_profile.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { updatePassword, UpdatePasswordError } from "../usecases/auth/update_password.ts";

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
  .delete("/users/me", async ({ authUserId, set }) => {
    await deleteAccount(authUserId);

    set.status = 200;
    return {
      message: "Account deleted successfully.",
    };
  })

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
    async ({ params, set }) => {
      const profile = await getPublicProfile(params.username);

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
  );

const usersRouter = withApiErrorHandler(new Elysia(), {
  UpdateProfileError,
  DeleteAccountError,
  RegisterDeviceError,
  GetPublicProfileError,
  UpdatePasswordError,
}).use(protectedUsersRouter);

export default usersRouter;
