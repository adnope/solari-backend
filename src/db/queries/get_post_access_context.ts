import { sql } from "drizzle-orm";
import { db } from "../client.ts";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbExecutor = typeof db | DbTransaction;

export type PostAccessContext = {
  authorId: string;
  isBlocked: boolean;
  isVisible: boolean;
};

type PostAccessContextRow = PostAccessContext & Record<string, unknown>;

export async function getPostAccessContext(
  viewerId: string,
  postId: string,
  executor: DbExecutor = db,
  includeBlockingCheck = true,
): Promise<PostAccessContext | null> {
  const blockingSelection = includeBlockingCheck
    ? sql`EXISTS(
        SELECT 1
        FROM blocked_users
        WHERE
          (blocker_id = ${viewerId}::uuid AND blocked_id = p.author_id)
          OR (blocker_id = p.author_id AND blocked_id = ${viewerId}::uuid)
      )`
    : sql`FALSE`;

  const rows = await executor.execute<PostAccessContextRow>(sql`
    SELECT
      p.author_id AS "authorId",
      ${blockingSelection} AS "isBlocked",
      EXISTS(
        SELECT 1
        FROM post_visibility
        WHERE post_id = p.id AND viewer_id = ${viewerId}::uuid
      ) AS "isVisible"
    FROM posts p
    WHERE p.id = ${postId}::uuid
    LIMIT 1;
  `);

  const row = rows[0];
  if (!row) return null;

  return {
    authorId: row.authorId,
    isBlocked: Boolean(row.isBlocked),
    isVisible: Boolean(row.isVisible),
  };
}
