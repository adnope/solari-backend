import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "../middleware/require_auth.ts";
import { updateProfile, UpdateProfileError } from "../usecases/users/update_profile.ts";
import { deleteAccount, DeleteAccountError } from "../usecases/users/delete_account.ts";

const usersRouter = new Hono<{ Variables: AuthVariables }>();

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

export default usersRouter;
