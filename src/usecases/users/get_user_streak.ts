import { isValidUuid } from "../../utils/uuid.ts";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { userStreaks } from "../../db/schema.ts";
import { AppError } from "../app_error.ts";

export type GetUserStreakInput = {
  userId: string;
  timezone: string;
};

export type GetUserStreakResult = {
  currentStreak: number;
  longestStreak: number;
  lastPostDate: string | null;
  isAlive: boolean;
  postedToday: boolean;
};

export type GetUserStreakErrorType = "MISSING_INPUT" | "INVALID_TIMEZONE" | "INTERNAL_ERROR";

function getLocalDateString(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export async function getUserStreak(input: GetUserStreakInput): Promise<GetUserStreakResult> {
  const normalizedUserId = input.userId.trim();
  const normalizedTimezone = input.timezone?.trim();

  if (!normalizedUserId || !isValidUuid(normalizedUserId)) {
    throw new AppError<GetUserStreakErrorType>("MISSING_INPUT", "Invalid user ID.", 400);
  }

  if (!normalizedTimezone) {
    throw new AppError<GetUserStreakErrorType>(
      "INVALID_TIMEZONE",
      "A valid IANA timezone is required.",
      400,
    );
  }

  try {
    Intl.DateTimeFormat(undefined, { timeZone: normalizedTimezone });
  } catch (err) {
    throw new AppError<GetUserStreakErrorType>("INVALID_TIMEZONE", "Invalid timezone format.", 400);
  }

  try {
    const [streakRow] = await db
      .select()
      .from(userStreaks)
      .where(eq(userStreaks.userId, normalizedUserId))
      .limit(1);

    if (!streakRow) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastPostDate: null,
        isAlive: false,
        postedToday: false,
      };
    }

    const lastPostDateUtc = streakRow.lastPostDate ? new Date(streakRow.lastPostDate) : null;
    let displayStreak = streakRow.currentStreak;
    let isAlive = false;
    let postedToday = false;

    if (lastPostDateUtc) {
      const nowUtc = new Date();
      const lastPostLocalStr = getLocalDateString(lastPostDateUtc, normalizedTimezone);
      const todayLocalStr = getLocalDateString(nowUtc, normalizedTimezone);

      const lastDate = new Date(`${lastPostLocalStr}T00:00:00`);
      const today = new Date(`${todayLocalStr}T00:00:00`);

      const diffTime = today.getTime() - lastDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

      if (diffDays === 0) {
        postedToday = true;
        isAlive = true;
      } else if (diffDays === 1) {
        postedToday = false;
        isAlive = true;
      } else {
        displayStreak = 0;
        postedToday = false;
        isAlive = false;
      }
    }

    return {
      currentStreak: displayStreak,
      longestStreak: streakRow.longestStreak,
      lastPostDate: streakRow.lastPostDate,
      isAlive,
      postedToday,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error(`[ERROR] Unexpected error fetching user streak: \n${error}`);
    throw new AppError<GetUserStreakErrorType>("INTERNAL_ERROR", "Internal server error.", 500);
  }
}
