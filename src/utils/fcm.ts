import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth({
  keyFile: "./firebase-service-account.json",
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID;

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
  | "NEW_MESSAGE_REACTION";

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
    }
  } catch (error) {
    console.error("FCM Request Failed:", error);
  }
}
