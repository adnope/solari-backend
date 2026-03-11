import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";
import { v7 } from "@std/uuid";
import { withDb } from "../../db/postgres_client.ts";

export type RegisterDeviceInput = {
  userId: string;
  deviceToken: string;
  platform: string;
};

export type RegisterDeviceErrorType = "MISSING_INPUT" | "INVALID_PLATFORM" | "INTERNAL_ERROR";

export class RegisterDeviceError extends Error {
  readonly type: RegisterDeviceErrorType;
  readonly statusCode: ContentfulStatusCode;

  constructor(type: RegisterDeviceErrorType, message: string, statusCode: ContentfulStatusCode) {
    super(message);
    this.name = "RegisterDeviceError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function registerDevice(input: RegisterDeviceInput): Promise<void> {
  const token = input.deviceToken.trim();
  const platform = input.platform.trim().toLowerCase();

  if (!token || !platform) {
    throw new RegisterDeviceError("MISSING_INPUT", "Device token and platform are required.", 400);
  }

  if (platform !== "android" && platform !== "ios") {
    throw new RegisterDeviceError("INVALID_PLATFORM", "Platform must be 'android', 'ios'", 400);
  }

  const deviceId = v7.generate();

  try {
    await withDb(async (client) => {
      await client.queryObject`
        INSERT INTO user_devices (id, user_id, device_token, platform)
        VALUES (${deviceId}, ${input.userId}, ${token}, ${platform})
        ON CONFLICT (device_token)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          platform = EXCLUDED.platform,
          updated_at = now()
      `;
    });
  } catch (_error) {
    throw new RegisterDeviceError(
      "INTERNAL_ERROR",
      "Internal server error registering device.",
      500,
    );
  }
}
