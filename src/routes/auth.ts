import { Hono } from "@hono/hono";
import { logOut, signIn, signUp } from "../usecases/auth.ts";

const authRouter = new Hono();

authRouter.post("/signup", async (c) => {
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
        user,
      },
      201,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal server error." }, 500);
  }
});

authRouter.post("/signin", async (c) => {
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
        user: result.user,
        sessionId: result.sessionId,
        refreshToken: result.refreshToken,
        expiresAt: result.expiresAt,
      },
      200,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal server error." }, 500);
  }
});

authRouter.post("/logout", async (c) => {
  try {
    const body = await c.req.json<{
      refreshToken: string;
    }>();

    const deleted = await logOut({
      refreshToken: body.refreshToken,
    });

    if (!deleted) {
      return c.json({ error: "Session not found." }, 404);
    }

    return c.json(
      {
        message: "Logged out successfully.",
      },
      200,
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return c.json({ error: "Invalid JSON body." }, 400);
    }

    if (error instanceof Error) {
      return c.json({ error: error.message }, 400);
    }

    return c.json({ error: "Internal server error." }, 500);
  }
});

export default authRouter;
