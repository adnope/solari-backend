import { isValidUuid } from "../../utils/validation.ts";
import { db } from "../../db/client.ts";
import { userDevices } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";
import { and, eq } from "drizzle-orm";

export type UnregisterDeviceInput = {
  userId: string;
  deviceToken: string;
};

export type UnregisterDeviceErrorType = "MISSING_INPUT" | "INTERNAL_ERROR";

export async function unregisterDevice(input: UnregisterDeviceInput): Promise<void> {
  const normalizedUserId = input.userId.trim();
  const token = input.deviceToken.trim();

  if (!normalizedUserId || !token) {
    throw new AppError<UnregisterDeviceErrorType>(
      "MISSING_INPUT",
      "Device token is required.",
      400,
    );
  }

  if (!isValidUuid(normalizedUserId)) {
    throw new AppError<UnregisterDeviceErrorType>("MISSING_INPUT", "User ID is invalid.", 400);
  }

  try {
    await db
      .delete(userDevices)
      .where(and(eq(userDevices.userId, normalizedUserId), eq(userDevices.deviceToken, token)));
  } catch (error) {
    console.error(`[ERROR] Unexpected error in use case: Unregister device\n${error}`);
    throw new AppError<UnregisterDeviceErrorType>(
      "INTERNAL_ERROR",
      "Internal server error unregistering device.",
      500,
    );
  }
}
