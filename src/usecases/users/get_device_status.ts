import { isValidUuid } from "../../utils/validation.ts";
import { db } from "../../db/client.ts";
import { userDevices } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";
import { and, eq } from "drizzle-orm";

export type GetDeviceStatusInput = {
  userId: string;
  deviceToken: string;
};

export type GetDeviceStatusOutput = {
  is_enabled: boolean;
};

export type GetDeviceStatusErrorType = "MISSING_INPUT" | "INTERNAL_ERROR";

export async function getDeviceStatus(input: GetDeviceStatusInput): Promise<GetDeviceStatusOutput> {
  const normalizedUserId = input.userId.trim();
  const token = input.deviceToken.trim();

  if (!normalizedUserId || !token) {
    throw new AppError<GetDeviceStatusErrorType>("MISSING_INPUT", "Device token is required.", 400);
  }

  if (!isValidUuid(normalizedUserId)) {
    throw new AppError<GetDeviceStatusErrorType>("MISSING_INPUT", "User ID is invalid.", 400);
  }

  try {
    const devices = await db
      .select({ id: userDevices.id })
      .from(userDevices)
      .where(and(eq(userDevices.userId, normalizedUserId), eq(userDevices.deviceToken, token)))
      .limit(1);

    return {
      is_enabled: devices.length > 0,
    };
  } catch (error) {
    console.error(`[ERROR] Unexpected error in use case: Get device status\n${error}`);
    throw new AppError<GetDeviceStatusErrorType>(
      "INTERNAL_ERROR",
      "Internal server error fetching device status.",
      500,
    );
  }
}
