import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  keyFile: "./firebase-service-account.json",
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

const FCM_PROJECT_ID = process.env["FCM_PROJECT_ID"];

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getGoogleAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  if (!accessToken.token) {
    throw new Error("Failed to generate Google OAuth token.");
  }

  cachedAccessToken = {
    token: accessToken.token,
    expiresAt: Date.now() + 50 * 60 * 1000,
  };

  return accessToken.token;
}

export type NotificationType =
  | "NEW_FRIEND_REQUEST"
  | "FRIEND_REQUEST_ACCEPTED"
  | "NEW_POST_REACTION"
  | "NEW_MESSAGE"
  | "NEW_MESSAGE_REACTION"
  | "STREAK_MILESTONE"
  | "NEW_POST_PUBLISHED";

function getAndroidNotificationConfig(type: NotificationType): {
  channel_id: string;
  priority: "HIGH" | "NORMAL";
} {
  switch (type) {
    case "NEW_MESSAGE":
      return { channel_id: "direct_messages", priority: "HIGH" };
    case "NEW_MESSAGE_REACTION":
    case "NEW_POST_REACTION":
      return { channel_id: "reactions", priority: "NORMAL" };
    case "NEW_FRIEND_REQUEST":
    case "FRIEND_REQUEST_ACCEPTED":
    case "NEW_POST_PUBLISHED":
      return { channel_id: "friend_activities", priority: "HIGH" };
    case "STREAK_MILESTONE":
      return { channel_id: "milestones_streaks", priority: "NORMAL" };
  }
}

type FcmMessagePayload = {
  message: {
    token: string;
    data: Record<string, string>;
    notification?: { title: string; body: string };
    android?: { priority: "HIGH" | "NORMAL"; notification?: { channel_id: string } };
    apns?: {
      payload: {
        aps: { alert: { title: string; body: string } };
      };
    };
  };
};

export async function sendPushNotification(
  deviceToken: string,
  title: string,
  body: string,
  notificationType: NotificationType,
  extraData: Record<string, string> = {},
): Promise<void> {
  if (!FCM_PROJECT_ID) {
    throw new Error("FCM_PROJECT_ID is missing from environment variables.");
  }

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

  const oauthToken = await getGoogleAccessToken();
  const androidConfig = getAndroidNotificationConfig(notificationType);

  const isDataOnly = notificationType === "NEW_POST_PUBLISHED";

  const payload: FcmMessagePayload = {
    message: {
      token: deviceToken,
      data: {
        type: notificationType,
        title,
        body,
        ...extraData,
      },
    },
  };

  if (!isDataOnly) {
    payload.message.notification = { title, body };
    payload.message.android = {
      priority: androidConfig.priority,
      notification: { channel_id: androidConfig.channel_id },
    };
  } else {
    payload.message.android = { priority: androidConfig.priority };
    payload.message.apns = {
      payload: { aps: { alert: { title, body } } },
    };
  }

  const response = await fetch(fcmUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauthToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FCM send failed (${response.status}): ${errorText}`);
  }
}
