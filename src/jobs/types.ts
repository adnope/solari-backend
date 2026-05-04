import type { NotificationType } from "../utils/fcm";
import type { CaptionMetadata } from "../db/schema.ts";

export type UploadPostJobPayload = {
  postId: string;
  authorId: string;
  objectKey: string;
  contentType: string;
  caption?: string;
  captionType?: string;
  captionMetadata?: CaptionMetadata | null;
  audienceType: "all" | "selected";
  viewerIds?: string[];
};

export type PushNotificationPayload = {
  recipientUserId: string;
  title: string;
  body: string;
  notificationType: NotificationType;
  extraData?: Record<string, string>;
};

export type SendEmailPayload = {
  emailType: "PASSWORD_RESET";
  to: string;
  username: string;
  code: string;
};

export type QueueNameToPayLoadMap = {
  "post-upload-processing": UploadPostJobPayload;
  "push-notification-processing": PushNotificationPayload;
  "send-email": SendEmailPayload;
};
export type QueueName = keyof QueueNameToPayLoadMap;
