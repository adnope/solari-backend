import { getFileUrl } from "../storage/s3.ts";

export type UserAvatarKey = {
  id: string;
  avatarKey: string | null;
};

export async function getAvatarUrlMapByUserId(
  users: Iterable<UserAvatarKey>,
): Promise<Map<string, string | null>> {
  const userList = Array.from(users);
  const avatarKeyByUserId = new Map<string, string>();
  const uniqueAvatarKeys = new Set<string>();

  for (const user of userList) {
    if (!user.avatarKey) {
      continue;
    }

    avatarKeyByUserId.set(user.id, user.avatarKey);
    uniqueAvatarKeys.add(user.avatarKey);
  }

  const avatarUrlByKey = new Map<string, string>();

  await Promise.all(
    Array.from(uniqueAvatarKeys).map(async (avatarKey) => {
      avatarUrlByKey.set(avatarKey, await getFileUrl(avatarKey));
    }),
  );

  const avatarUrlByUserId = new Map<string, string | null>();

  for (const user of userList) {
    const avatarKey = avatarKeyByUserId.get(user.id);
    avatarUrlByUserId.set(user.id, avatarKey ? (avatarUrlByKey.get(avatarKey) ?? null) : null);
  }

  return avatarUrlByUserId;
}
