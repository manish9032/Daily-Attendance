import {
  FlowerSpecies,
  HolidayItem,
  PlantHealthState,
  PlantStage,
  UserProfile,
} from '../types';

/**
 * SHARED school-calendar + streak/plant rules.
 * Imported by BOTH the browser app and the Express server (server.ts), so the
 * server is the authority and the client only mirrors the same logic for display.
 * Keep this file free of browser-only APIs (no window, fetch, document).
 */

export const FLOWER_CYCLE_ORDER: FlowerSpecies[] = [
  'Sunflower',
  'Rose',
  'Lotus',
  'Orchid',
];

/**
 * Built-in School Calendar Holidays synchronized with the backend gatekeeper.
 */
export const BUILT_IN_SCHOOL_HOLIDAYS: Record<string, string> = {
  '2026-01-26': 'Republic Day',
  '2026-03-04': 'Holi Festival Break',
  '2026-08-15': 'Independence Day',
  '2026-10-02': 'Gandhi Jayanti',
  '2026-10-20': 'Dussehra School Holiday',
  '2026-11-08': 'Diwali Festival Holiday',
  '2026-11-09': 'Govardhan Puja Holiday',
  '2026-12-25': 'Christmas Day',
  '2027-01-26': 'Republic Day',
  '2027-08-15': 'Independence Day',
  '2027-10-02': 'Gandhi Jayanti',
  '2027-12-25': 'Christmas Day',
};

/**
 * Maps a 30-day cycle day (0 to 30) to one of the 5 PRD growth stages:
 * Seed, Sprout, Sapling, Bud, Full Bloom.
 */
export function getPlantStageFromCycleDay(cycleDay: number): PlantStage {
  if (cycleDay <= 0) return 'Seed';
  if (cycleDay <= 6) return 'Sprout';
  if (cycleDay <= 14) return 'Sapling';
  if (cycleDay <= 23) return 'Bud';
  return 'Full Bloom';
}

export function getNextFlowerSpecies(current: FlowerSpecies): FlowerSpecies {
  const idx = FLOWER_CYCLE_ORDER.indexOf(current);
  if (idx === -1) return 'Sunflower';
  return FLOWER_CYCLE_ORDER[(idx + 1) % FLOWER_CYCLE_ORDER.length];
}

/**
 * Helper to step day-by-day between two YYYY-MM-DD strings (exclusive of both endpoints)
 * and count how many required school days were missed.
 * Sundays (UTC day 0), built-in school holidays, and student-configured custom holidays are excluded.
 */
export function countMissedSchoolDaysBetween(
  lastDateStr: string,
  currentNetworkDateStr: string,
  holidays: Record<string, HolidayItem>
): number {
  if (!lastDateStr || lastDateStr >= currentNetworkDateStr) {
    return 0;
  }

  const start = new Date(`${lastDateStr}T00:00:00Z`);
  const end = new Date(`${currentNetworkDateStr}T00:00:00Z`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 1) {
    return 0;
  }

  let missedSchoolDays = 0;
  for (let i = 1; i < diffDays; i++) {
    const checkDate = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    const dateKey = checkDate.toISOString().slice(0, 10);
    const isSunday = checkDate.getUTCDay() === 0;
    const isHoliday =
      Boolean(holidays[dateKey]) || Boolean(BUILT_IN_SCHOOL_HOLIDAYS[dateKey]);

    if (!isSunday && !isHoliday) {
      missedSchoolDays++;
    }
  }

  return missedSchoolDays;
}

/**
 * Evaluates whether the student's plant should wilt (missed 1 school day)
 * or reset to a Seed (missed >= 2 consecutive school days) based on trusted network time.
 */
export function evaluateStreakReconciliation(
  profile: UserProfile,
  networkDate: string,
  holidays: Record<string, HolidayItem>
): {
  needsUpdate: boolean;
  currentStreak: number;
  plantCycleDay: number;
  plantHealth: PlantHealthState;
  consecutiveMissedDays: number;
} {
  if (!profile.lastAttendanceDate) {
    return {
      needsUpdate: false,
      currentStreak: profile.currentStreak,
      plantCycleDay: profile.plantCycleDay,
      plantHealth: profile.plantHealth,
      consecutiveMissedDays: profile.consecutiveMissedDays,
    };
  }

  // If already marked today, plant is always healthy
  if (profile.lastAttendanceDate === networkDate) {
    const needsHealthyFix =
      profile.plantHealth !== 'healthy' || profile.consecutiveMissedDays !== 0;
    return {
      needsUpdate: needsHealthyFix,
      currentStreak: profile.currentStreak,
      plantCycleDay: profile.plantCycleDay,
      plantHealth: 'healthy',
      consecutiveMissedDays: 0,
    };
  }

  const missedDays = countMissedSchoolDaysBetween(
    profile.lastAttendanceDate,
    networkDate,
    holidays
  );

  if (missedDays === 0) {
    // No missed school days (either consecutive day or separated only by Sunday/holidays)
    return {
      needsUpdate: false,
      currentStreak: profile.currentStreak,
      plantCycleDay: profile.plantCycleDay,
      plantHealth: profile.plantHealth,
      consecutiveMissedDays: 0,
    };
  }

  if (missedDays === 1) {
    // Confirmed Decision 1: Wilt first when 1 school day is missed
    const changed =
      profile.plantHealth !== 'wilted' || profile.consecutiveMissedDays !== 1;
    return {
      needsUpdate: changed,
      currentStreak: profile.currentStreak,
      plantCycleDay: profile.plantCycleDay,
      plantHealth: 'wilted',
      consecutiveMissedDays: 1,
    };
  }

  // Missed >= 2 school days: Reset to seed and streak = 0
  const changed =
    profile.currentStreak !== 0 ||
    profile.plantCycleDay !== 0 ||
    profile.plantHealth !== 'healthy' ||
    profile.consecutiveMissedDays !== missedDays;

  return {
    needsUpdate: changed,
    currentStreak: 0,
    plantCycleDay: 0,
    plantHealth: 'healthy',
    consecutiveMissedDays: missedDays,
  };
}
