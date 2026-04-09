import { inArray, and, eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { posts } from "../../db/schema.ts";
import { getJobStatusKey, redisClient } from "../../jobs/queue.ts";

export type PostUploadStatus = "UPLOADING" | "PROCESSING" | "COMPLETED" | "FAILED" | "NOT_FOUND";

export async function getPostUploadStatuses(
  authorId: string,
  postIds: string[],
): Promise<Record<string, PostUploadStatus>> {
  if (!postIds || postIds.length === 0) return {};

  const uniqueIds = [...new Set(postIds)].slice(0, 20);
  const statuses: Record<string, PostUploadStatus> = {};

  const existingPosts = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(inArray(posts.id, uniqueIds), eq(posts.authorId, authorId)));

  const dbPostIds = new Set(existingPosts.map((p) => p.id));

  for (const id of dbPostIds) {
    statuses[id] = "COMPLETED";
  }

  const remainingIds = uniqueIds.filter((id) => !dbPostIds.has(id));
  if (remainingIds.length === 0) return statuses;

  const jobKeys = remainingIds.map((id) => getJobStatusKey(id));
  const ticketKeys = remainingIds.map((id) => `upload_ticket:${id}`);

  const jobStatuses = await redisClient.mget(...jobKeys);
  const tickets = await redisClient.mget(...ticketKeys);

  remainingIds.forEach((id, i) => {
    const jobStatus = jobStatuses[i];
    const ticketString = tickets[i];

    if (jobStatus === "failed") {
      statuses[id] = "FAILED";
    } else if (jobStatus === "processing" || jobStatus === "pending") {
      statuses[id] = "PROCESSING";
    } else if (ticketString) {
      try {
        const ticketData = JSON.parse(ticketString);
        if (ticketData.authorId === authorId) {
          statuses[id] = "UPLOADING";
        } else {
          statuses[id] = "NOT_FOUND";
        }
      } catch {
        statuses[id] = "NOT_FOUND";
      }
    } else {
      statuses[id] = "NOT_FOUND";
    }
  });

  return statuses;
}
