import { Hono } from "hono";
import { requireAuth, type AuthVariables } from "../middleware/require_auth.ts";
import { deleteAccount, DeleteAccountError } from "../usecases/users/delete_account.ts";
import { registerDevice, RegisterDeviceError } from "../usecases/users/register_device.ts";
import { updateProfile, UpdateProfileError } from "../usecases/users/update_profile.ts";

const usersRouter = new Hono<{ Variables: AuthVariables }>();

// Update user profile
usersRouter.patch("/users/me", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const body = await c.req.parseBody();

    const email = typeof body["email"] === "string" ? body["email"] : undefined;
    const displayName = typeof body["display_name"] === "string" ? body["display_name"] : undefined;

    let avatar: { buffer: Uint8Array; contentType: string } | undefined = undefined;
    const avatarFile = body["avatar"];

    if (avatarFile instanceof File) {
      avatar = {
        buffer: new Uint8Array(await avatarFile.arrayBuffer()),
        contentType: avatarFile.type,
      };
    }

    const result = await updateProfile({
      userId,
      email,
      displayName,
      avatar,
    });

    return c.json(
      {
        message: "Profile updated successfully.",
        user: {
          id: result.id,
          username: result.username,
          email: result.email,
          display_name: result.display_name,
          avatar_key: result.avatar_key,
          updated_at: result.updated_at,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof UpdateProfileError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json(
      {
        error: { type: "INTERNAL_ERROR", message: "Internal server error." },
      },
      500,
    );
  }
});

// Delete account
usersRouter.delete("/users/me", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");

    await deleteAccount(userId);

    return c.json({ message: "Account deleted successfully." }, 200);
  } catch (error) {
    if (error instanceof DeleteAccountError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json(
      {
        error: { type: "INTERNAL_ERROR", message: "Internal server error." },
      },
      500,
    );
  }
});

// Register a device for push notifications
usersRouter.post("/users/me/devices", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const body = await c.req.json<{
      device_token?: string;
      platform?: string;
    }>();

    if (!body.device_token || !body.platform) {
      return c.json(
        { error: { type: "MISSING_INPUT", message: "device_token and platform are required." } },
        400,
      );
    }

    await registerDevice({
      userId,
      deviceToken: body.device_token,
      platform: body.platform,
    });

    return c.json({ message: "Device registered successfully." }, 200);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ error: { type: "INVALID_JSON", message: "Invalid JSON body." } }, 400);
    }

    if (error instanceof RegisterDeviceError) {
      return c.json({ error: { type: error.type, message: error.message } }, error.statusCode);
    }

    return c.json({ error: { type: "INTERNAL_ERROR", message: "Internal server error." } }, 500);
  }
});

export default usersRouter;
