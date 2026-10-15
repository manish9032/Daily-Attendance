import { getFirebaseIdToken } from './firebase';

export interface MarkAttendanceResult {
  dateId: string;
  streak: number;
  completedCycle: boolean;
  wateredFlower: string;
  newFlower: string;
}

async function authedPost<T>(url: string, body: unknown): Promise<T> {
  const token = await getFirebaseIdToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Request failed. Please try again.');
  }
  return payload as T;
}

/**
 * Sends the live selfie frame to the server. The SERVER verifies the face,
 * checks Sunday / holidays, and writes attendance + streak + plant state.
 * The frame is analysed in memory and never stored.
 */
export function markAttendanceOnServer(selfieJpegDataUrl: string): Promise<MarkAttendanceResult> {
  return authedPost<MarkAttendanceResult>('/api/attendance/mark', {
    selfie: selfieJpegDataUrl,
  });
}

/** Asks the server to apply wilt / reset rules for today. */
export function reconcileStreakOnServer(): Promise<{ updated: boolean }> {
  return authedPost<{ updated: boolean }>('/api/streak/reconcile', {});
}

/** Deletes the student's attendance history on the server (clients cannot delete it). */
export function deleteAttendanceHistoryOnServer(): Promise<{ deleted: number }> {
  return authedPost<{ deleted: number }>('/api/account/delete-attendance', {});
}
