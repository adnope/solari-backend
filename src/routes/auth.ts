import { Hono } from "@hono/hono";
import { AuthError, logOut, me, signIn, signUp } from "../usecases/auth/auth.ts";
import { AuthVariables, requireAuth } from "../middleware/require_auth.ts";

const authRouter = new Hono<{
  Variables: AuthVariables;
}>();

// Create a new account
authRouter.post("/users", async (c) => {
  try {
    const body = await c.req.json<{
      username: string;
      email: string;
      password: string;
    }>();

    const user = await signUp({
      username: body.username,
      email: body.email,
      password: body.password,
    });

    return c.json(
      {
        message: "Account created successfully.",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.displayName,
          avatar_key: user.avatarKey,
          created_at: user.createdAt,
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

    if (error instanceof AuthError) {
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

// Sign in (create new session)
authRouter.post("/sessions", async (c) => {
  try {
    const body = await c.req.json<{
      identifier: string;
      password: string;
    }>();

    const result = await signIn({
      identifier: body.identifier,
      password: body.password,
    });

    return c.json(
      {
        message: "Signed in successfully.",
        session_id: result.sessionId,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: result.expiresAt,
      },
      200,
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

    if (error instanceof AuthError) {
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

// Log out of current session
authRouter.delete("/sessions/current", requireAuth, async (c) => {
  try {
    const sessionId = c.get("authSessionId");
    const deleted = await logOut(sessionId);

    return c.json(
      {
        message: deleted ? "Logged out successfully." : "Logged out successfully.",
      },
      200,
    );
  } catch (error) {
    if (error instanceof AuthError) {
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

// Get current user info
authRouter.get("/me", requireAuth, async (c) => {
  try {
    const userId = c.get("authUserId");
    const sessionId = c.get("authSessionId");
    const result = await me(userId);

    return c.json(
      {
        message: "Got me",
        session_id: sessionId,
        user: {
          id: result.id,
          username: result.username,
          email: result.email,
          display_name: result.displayName,
          avatar_key: result.avatarKey,
          created_at: result.createdAt,
        },
      },
      200,
    );
  } catch (error) {
    if (error instanceof AuthError) {
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

export default authRouter;
