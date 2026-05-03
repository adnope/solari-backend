import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  keyFile: "./firebase-service-account.json",
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

const FCM_PROJECT_ID = process.env["FCM_PROJECT_ID"];

export async function getGoogleAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();

  if (!accessToken.token) {
    throw new Error("Failed to generate Google OAuth token.");
  }

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

export async function sendPushNotification(
  deviceToken: string,
  title: string,
  body: string,
  notificationType: NotificationType,
  extraData: Record<string, string> = {},
) {
  if (!FCM_PROJECT_ID) {
    console.error("FCM Error: FCM_PROJECT_ID is missing from environment variables.");
    return;
  }

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

  try {
    const oauthToken = await getGoogleAccessToken();
    const androidConfig = getAndroidNotificationConfig(notificationType);

    const payload = {
      message: {
        token: deviceToken,
        notification: {
          title,
          body,
        },
        data: {
          type: notificationType,
          ...extraData,
        },
        android: {
          priority: androidConfig.priority,
          notification: {
            channel_id: androidConfig.channel_id,
          },
        },
      },
    };

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
      console.error("FCM Send Error:", errorText);
    } else {
      console.log(`[FCM] Sent ${notificationType} notification to device: ${deviceToken}`);
    }
  } catch (error) {
    console.error("FCM Request Failed:", error);
  }
}
