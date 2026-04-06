export type StreakResult = {
  newStreak: number;
  isNewRecord: boolean;
  isValidIncrement: boolean;
};

function getLocalDateString(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function calculateNewStreak(
  currentStreak: number,
  longestStreak: number,
  lastPostDateUtc: Date | null,
  userTimezone: string
): StreakResult {
  
  if (!lastPostDateUtc) {
    return { newStreak: 1, isNewRecord: longestStreak < 1, isValidIncrement: true };
  }

  const nowUtc = new Date();

  const lastPostLocalStr = getLocalDateString(lastPostDateUtc, userTimezone);
  const todayLocalStr = getLocalDateString(nowUtc, userTimezone);

  const lastDate = new Date(`${lastPostLocalStr}T00:00:00`);
  const today = new Date(`${todayLocalStr}T00:00:00`);

  const diffTime = today.getTime() - lastDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

  if (diffDays === 0) {
    return { newStreak: currentStreak, isNewRecord: false, isValidIncrement: false };
  } else if (diffDays === 1) {
    const newStreak = currentStreak + 1;
    return { newStreak, isNewRecord: newStreak > longestStreak, isValidIncrement: true };
  } else {
    return { newStreak: 1, isNewRecord: false, isValidIncrement: true };
  }
}