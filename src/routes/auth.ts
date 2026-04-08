import { Elysia, t } from "elysia";
import { AuthError } from "../usecases/auth/error_type.ts";
import { me } from "../usecases/auth/me.ts";
import { refreshSession } from "../usecases/auth/refresh_session.ts";
import {
  requestPasswordResetCode,
  RequestPasswordResetCodeError,
} from "../usecases/auth/request_password_reset_code.ts";
import { resetPassword, ResetPasswordError } from "../usecases/auth/reset_password.ts";
import { signIn } from "../usecases/auth/sign_in.ts";
import { signInWithGoogle } from "../usecases/auth/sign_in_with_google.ts";
import { signOut } from "../usecases/auth/sign_out.ts";
import { signUp } from "../usecases/auth/sign_up.ts";
import {
  verifyPasswordResetCode,
  VerifyPasswordResetCodeError,
} from "../usecases/auth/verify_password_reset_code.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { requireAuth } from "./middleware/require_auth.ts";

const protectedAuthRouter = new Elysia()
  .use(requireAuth)

  // Refresh session
  .post(
    "/sessions/refresh",
    async ({ body, authSessionId, set }) => {
      const result = await refreshSession({
        sessionId: authSessionId,
        refreshToken: body.refresh_token,
      });

      set.status = 200;
      return {
        message: "Session refreshed successfully.",
        session_id: result.sessionId,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: result.expiresAt,
      };
    },
    {
      body: t.Object({
        refresh_token: t.String(),
      }),
    },
  )

  // Sign out
  .post(
    "/signout",
    async ({ body, authSessionId, set }) => {
      const deleted = await signOut(authSessionId, body?.device_token);

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

  // Me (Get current logged-in user's info)
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
  {
    AuthError,
    RequestPasswordResetCodeError,
    VerifyPasswordResetCodeError,
    ResetPasswordError,
  },
  { validationErrorType: "INVALID_JSON" },
)
  // Sign up a new account
  .post(
    "/signup",
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
    "/signin",
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

  // Sign in with google
  .post(
    "/signin/google",
    async ({ body, set }) => {
      const result = await signInWithGoogle(body.id_token);

      set.status = 200;
      return {
        message: "Signed in with Google successfully.",
        session_id: result.sessionId,
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_at: result.expiresAt,
      };
    },
    {
      body: t.Object({
        id_token: t.String(),
      }),
    },
  )

  // Request password reset code
  .post(
    "/password-resets",
    async ({ body, set }) => {
      await requestPasswordResetCode(body.email);

      set.status = 200;
      return {
        message: "If that account exists, a password reset code has been sent.",
      };
    },
    {
      body: t.Object({
        email: t.String(),
      }),
    },
  )

  // Verify password reset code
  .post(
    "/password-resets/verify",
    async ({ body, set }) => {
      await verifyPasswordResetCode({
        email: body.email,
        code: body.code,
      });

      set.status = 200;
      return {
        message: "Password reset code verified successfully.",
        verified: true,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        code: t.String(),
      }),
    },
  )

  // Set new password after code verification
  .post(
    "/password-resets/complete",
    async ({ body, set }) => {
      await resetPassword({
        email: body.email,
        newPassword: body.new_password,
      });

      set.status = 200;

      return {
        message: "Password reset successfully.",
      };
    },
    {
      body: t.Object({
        email: t.String(),
        new_password: t.String(),
      }),
    },
  )
  .use(protectedAuthRouter);

export default authRouter;
