import { Elysia, t } from "elysia";
import { setNickname, SetNicknameError } from "../usecases/nicknames/set_nickname.ts";
import { updateNickname, UpdateNicknameError } from "../usecases/nicknames/update_nickname.ts";
import { removeNickname, RemoveNicknameError } from "../usecases/nicknames/remove_nickname.ts";
import { withApiErrorHandler } from "./api_error_handler.ts";
import { requireAuth } from "./middleware/require_auth.ts";
import { getNickname } from "../usecases/nicknames/get_nickname.ts";
import { getAllNicknames } from "../usecases/nicknames/get_all_nicknames.ts";

const protectedNicknamesRouter = new Elysia()
  .use(requireAuth)

  // Set a new nickname
  .post(
    "/nicknames/:targetUserId",
    async ({ authUserId, params, body, set }) => {
      const result = await setNickname(authUserId, params.targetUserId, body.nickname);

      set.status = 201;
      return {
        message: "Nickname set successfully.",
        data: {
          target_user_id: params.targetUserId,
          nickname: result.nickname,
        },
      };
    },
    {
      params: t.Object({
        targetUserId: t.String({ error: "Target user ID parameter is required." }),
      }),
      body: t.Object({
        nickname: t.String({ error: "Nickname is required." }),
      }),
    },
  )

  // Update an existing nickname
  .patch(
    "/nicknames/:targetUserId",
    async ({ authUserId, params, body, set }) => {
      const result = await updateNickname(authUserId, params.targetUserId, body.new_nickname);

      set.status = 200;
      return {
        message: "Nickname updated successfully.",
        data: {
          target_user_id: params.targetUserId,
          nickname: result.nickname,
        },
      };
    },
    {
      params: t.Object({
        targetUserId: t.String({ error: "Target user ID parameter is required." }),
      }),
      body: t.Object({
        new_nickname: t.String({ error: "Nickname is required." }),
      }),
    },
  )

  // Remove a nickname
  .delete(
    "/nicknames/:targetUserId",
    async ({ authUserId, params, set }) => {
      await removeNickname(authUserId, params.targetUserId);

      set.status = 200;
      return {
        message: "Nickname removed successfully.",
        data: {
          target_user_id: params.targetUserId,
        },
      };
    },
    {
      params: t.Object({
        targetUserId: t.String({ error: "Target user ID parameter is required." }),
      }),
    },
  )

  // Get a specific nickname
  .get(
    "/nicknames/:targetUserId",
    async ({ authUserId, params }) => {
      const result = await getNickname(authUserId, params.targetUserId);
      return {
        nickname: result.nickname,
      };
    },
    {
      params: t.Object({
        targetUserId: t.String(),
      }),
    },
  )

  // Get nicknames for all friends
  .get("/nicknames", async ({ authUserId }) => {
    const result = await getAllNicknames(authUserId);

    return {
      items: result.nicknames.map((n) => ({
        target_id: n.targetId,
        nickname: n.nickname,
      })),
    };
  });

const nicknamesRouter = withApiErrorHandler(new Elysia(), {
  SetNicknameError,
  UpdateNicknameError,
  RemoveNicknameError,
}).use(protectedNicknamesRouter);

export default nicknamesRouter;
