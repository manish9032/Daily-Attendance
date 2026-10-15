import { HolidayItem, NetworkTimePayload } from '../types';
import { BUILT_IN_SCHOOL_HOLIDAYS } from '../shared/schoolCalendar';

// Re-exported so existing imports keep working. The real logic lives in
// src/shared/schoolCalendar.ts and is shared with the server.
export {
  FLOWER_CYCLE_ORDER,
  BUILT_IN_SCHOOL_HOLIDAYS,
  getPlantStageFromCycleDay,
  getNextFlowerSpecies,
  countMissedSchoolDaysBetween,
  evaluateStreakReconciliation,
} from '../shared/schoolCalendar';

/**
 * Checks whether a given YYYY-MM-DD date string is a Sunday or a configured holiday.
 */
export function checkSundayOrHoliday(
  dateId: string,
  customHolidays: Record<string, HolidayItem> = {}
): { blocked: boolean; reason: string | null } {
  if (!dateId || !/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    return { blocked: true, reason: 'Invalid attendance date format.' };
  }

  const dateObj = new Date(`${dateId}T00:00:00Z`);
  if (dateObj.getUTCDay() === 0) {
    return {
      blocked: true,
      reason: 'Attendance cannot be marked on Sundays. Your streak and plant growth remain safe!',
    };
  }

  const holidayLabel =
    customHolidays[dateId]?.label || BUILT_IN_SCHOOL_HOLIDAYS[dateId] || null;
  if (holidayLabel) {
    return {
      blocked: true,
      reason: `Attendance cannot be marked on a school holiday (${holidayLabel}). Your streak and plant growth remain safe!`,
    };
  }

  return { blocked: false, reason: null };
}

/**
 * Calls the backend validation endpoint (POST /api/attendance/validate) to verify
 * that the target date is an active school day (not a Sunday or configured holiday)
 * before creating any attendance record.
 */
export async function validateAttendanceDayOnBackend(
  dateId: string,
  customHolidays: Record<string, HolidayItem> = {}
): Promise<{ networkDate: string; isoTimestamp: string }> {
  // Local pre-check for Sunday or holiday
  const preCheck = checkSundayOrHoliday(dateId, customHolidays);
  if (preCheck.blocked) {
    throw new Error(
      preCheck.reason || 'Attendance is blocked on Sundays and school holidays.'
    );
  }

  const response = await fetch('/api/attendance/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      dateId,
      customHolidays,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.allowed) {
    throw new Error(
      payload.error ||
        'Attendance cannot be marked on Sundays or school holidays.'
    );
  }

  return {
    networkDate: payload.networkDate,
    isoTimestamp: payload.isoTimestamp,
  };
}

/**
 * Fetches trusted server network time from GET /api/time.
 * Never falls back to the local device clock if offline (PRD 6.1:
 * "If network time is unavailable, block marking and ask the student to connect to the internet.")
 */
export async function fetchTrustedNetworkTime(): Promise<NetworkTimePayload> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Network time unavailable while offline. Please connect to the internet to verify today\'s date.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`/api/time?_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Server time verification failed (${response.status})`);
    }
    const data = (await response.json()) as NetworkTimePayload;
    if (!data.trusted || !data.networkDate) {
      throw new Error('Untrusted time response');
    }
    return data;
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : 'Unable to reach trusted network time server. Please check your internet connection.'
    );
  } finally {
    clearTimeout(timeout);
  }
}

