import { TaskItem } from '../types';

const LOCAL_TASKS_CACHE_KEY = 'daily_attendance_cached_tasks_v1';
const FIRED_ALARMS_CACHE_KEY = 'daily_attendance_fired_alarms_v1';

/**
 * Mirrors tasks into localStorage so local alarms are immediately restored
 * upon browser/device restart even before network sync completes.
 */
export function syncTasksToLocalAlarmCache(tasks: TaskItem[]): void {
  try {
    localStorage.setItem(LOCAL_TASKS_CACHE_KEY, JSON.stringify(tasks));
  } catch {
    // Ignore storage quota errors
  }
}

export function getCachedTasksForAlarms(): TaskItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_TASKS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TaskItem[];
  } catch {
    return [];
  }
}

function getFiredAlarmsMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FIRED_ALARMS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function markAlarmFiredForSignature(signature: string): void {
  try {
    const map = getFiredAlarmsMap();
    map[signature] = Date.now();
    localStorage.setItem(FIRED_ALARMS_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

export function hasAlarmFiredRecently(signature: string): boolean {
  const map = getFiredAlarmsMap();
  const ts = map[signature];
  if (!ts) return false;
  // Prevent duplicate ring for the same task schedule signature within 45 minutes
  return Date.now() - ts < 45 * 60 * 1000;
}

/**
 * Plays a distinct, melodic 3-pulse chime using the Web Audio API
 * (zero external audio file dependencies, works 100% offline).
 */
export function playAlarmChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const startTime = ctx.currentTime + idx * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.28, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.36);
    });
  } catch {
    // Ignore audio context autoplay restrictions if user hasn't interacted yet
  }
}

/**
 * Registers the Service Worker and triggers a system notification for a ringing task alarm
 */
export async function triggerSystemAlarmNotification(task: TaskItem): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const categoryLabel =
    task.category === 'board_exam'
      ? 'Board Exam Alert'
      : task.category === 'submission'
      ? 'Submission Deadline'
      : 'Homework Reminder';

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(`${categoryLabel}: ${task.title}`, {
          body: task.notes
            ? `${task.dueTime} — ${task.notes}`
            : `Scheduled for ${task.dueDate} at ${task.dueTime}`,
          icon: '/icon.svg',
          badge: '/icon.svg',
          tag: `task-alarm-${task.taskId}`,
          requireInteraction: true,
          data: { taskId: task.taskId },
        });
        return;
      }
    }

    new Notification(`${categoryLabel}: ${task.title}`, {
      body: `Due at ${task.dueTime}`,
      icon: '/icon.svg',
    });
  } catch {
    // Fallback handled by in-app alarm banner
  }
}
