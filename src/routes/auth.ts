import { Elysia, t } from "elysia";
import { requireAuth } from "./middleware/require_auth.ts";
import { AuthError, logOut, me, signIn, signUp } from "../usecases/auth/auth.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";

const protectedAuthRouter = new Elysia()
  .use(requireAuth)

  // Log out
  .delete(
    "/sessions/current",
    async ({ body, authSessionId, set }) => {
      const deleted = await logOut(authSessionId, body?.device_token);

      set.status = 200;
      return {
        message: deleted ? "Logged out successfully." : "Logged out successfully.",
      };
    },
    {
      body: t.Optional(
        t.Object({
          device_token: t.Optional(t.String()),
        }),
      ),
    },
  )

  // Get current logged-in user's info
  .get("/me", async ({ authUserId, authSessionId, set }) => {
    const result = await me(authUserId);

    set.status = 200;
    return {
      message: "Got me",
      session_id: authSessionId,
      user: {
        id: result.id,
        username: result.username,
        email: result.email,
        display_name: result.displayName,
        avatar_key: result.avatarKey,
        created_at: result.createdAt,
      },
    };
  });

const authRouter = withApiErrorHandler(
  new Elysia(),
  { AuthError },
  { validationErrorType: "INVALID_JSON" },
)
  // Sign up a new account
  .post(
    "/users",
    async ({ body, set }) => {
      const user = await signUp({
        username: body.username,
        email: body.email,
        password: body.password,
      });

      set.status = 201;
      return {
        message: "Account created successfully.",
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          display_name: user.displayName,
          avatar_key: user.avatarKey,
          created_at: user.createdAt,
        },
      };
    },
    {
      body: t.Object({
        username: t.String(),
        email: t.String(),
        password: t.String(),
      }),
    },
  )

  // Sign in
  .post(
    "/sessions",
    async ({ body, set }) => {
      const result = await signIn({
        identifier: body.identifier,
        password: body.password,
      });

      set.status = 200;
      return {
        message: "Signed in successfully.",
        session_id: result.sessionId,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: result.expiresAt,
      };
    },
    {
      body: t.Object({
        identifier: t.String(),
        password: t.String(),
      }),
    },
  )
  .use(protectedAuthRouter);

export default authRouter;
