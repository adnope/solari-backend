import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { userDevices } from "../../db/schema.ts";
import { sendPushNotification } from "../../utils/fcm.ts";
import type { PushNotificationPayload } from "../types.ts";

export async function handlePushNotification(
  jobId: string,
  payload: PushNotificationPayload,
): Promise<void> {
  console.log(`[FCM WORKER] Received job with ID: ${jobId}`);

  const devices = await db
    .select({ deviceToken: userDevices.deviceToken })
    .from(userDevices)
    .where(eq(userDevices.userId, payload.recipientUserId));

  if (devices.length === 0) {
    console.log(`[FCM WORKER] Job '${jobId}': User has no registered devices. Skipping.`);
    return;
  }

  const pushPromises = devices.map((device) =>
    sendPushNotification(
      device.deviceToken,
      payload.title,
      payload.body,
      payload.notificationType,
      payload.extraData,
    ),
  );

  await Promise.allSettled(pushPromises);

  console.log(
    `[FCM WORKER] Job '${jobId}': Broadcasted ${payload.notificationType} to ${devices.length} devices.`,
  );
}
