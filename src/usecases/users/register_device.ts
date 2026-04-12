import { isValidUuid } from "../../utils/uuid.ts";
import { db } from "../../db/client.ts";
import { userDevices } from "../../db/schema.ts";

export type RegisterDeviceInput = {
  userId: string;
  deviceToken: string;
  platform: string;
};

export type RegisterDeviceErrorType = "MISSING_INPUT" | "INVALID_PLATFORM" | "INTERNAL_ERROR";

export class RegisterDeviceError extends Error {
  readonly type: RegisterDeviceErrorType;
  readonly statusCode: number;

  constructor(type: RegisterDeviceErrorType, message: string, statusCode: number) {
    super(message);
    this.name = "RegisterDeviceError";
    this.type = type;
    this.statusCode = statusCode;
  }
}

export async function registerDevice(input: RegisterDeviceInput): Promise<void> {
  const normalizedUserId = input.userId.trim();
  const token = input.deviceToken.trim();
  const platform = input.platform.trim().toLowerCase();

  if (!normalizedUserId || !token || !platform) {
    throw new RegisterDeviceError("MISSING_INPUT", "Device token and platform are required.", 400);
  }

  if (!isValidUuid(normalizedUserId)) {
    throw new RegisterDeviceError("MISSING_INPUT", "User ID is invalid.", 400);
  }

  if (platform !== "android" && platform !== "ios") {
    throw new RegisterDeviceError("INVALID_PLATFORM", "Platform must be 'android', 'ios'", 400);
  }

  const deviceId = Bun.randomUUIDv7();

  try {
    await db
      .insert(userDevices)
      .values({
        id: deviceId,
        userId: normalizedUserId,
        deviceToken: token,
        platform,
      })
      .onConflictDoUpdate({
        target: userDevices.deviceToken,
        set: {
          userId: normalizedUserId,
          platform,
          updatedAt: new Date().toISOString(),
        },
      });
  } catch (error) {
    console.error(`[ERROR] Unexpected error in use case: Register device\n${error}`);
    throw new RegisterDeviceError(
      "INTERNAL_ERROR",
      "Internal server error registering device.",
      500,
    );
  }
}
