import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { registerSecureAttendanceRoutes } from './server/secureAttendance';
import { BUILT_IN_SCHOOL_HOLIDAYS } from './src/shared/schoolCalendar';

// AI Studio injects env vars; locally we read .env.local (see README) then .env
dotenv.config({ path: '.env.local' });
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single source of truth for holidays lives in src/shared/schoolCalendar.ts
const SCHOOL_CALENDAR_HOLIDAYS = BUILT_IN_SCHOOL_HOLIDAYS;

function getAuthoritativeSchoolDayState() {
  const now = new Date();
  // Calculate IST (UTC+5:30) date string as well as UTC ISO timestamp
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDateObj = new Date(now.getTime() + istOffsetMs);
  const networkDate = istDateObj.toISOString().slice(0, 10); // YYYY-MM-DD
  const dayOfWeek = istDateObj.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const isSunday = dayOfWeek === 0;
  const holidayLabel = SCHOOL_CALENDAR_HOLIDAYS[networkDate] || null;
  const isHoliday = Boolean(holidayLabel);

  return {
    trusted: true,
    isoTimestamp: now.toISOString(),
    epochMs: now.getTime(),
    networkDate,
    dayOfWeek,
    isSunday,
    isHoliday,
    holidayLabel,
    canMarkAttendance: !isSunday && !isHoliday,
    timezone: 'Asia/Kolkata (IST)',
  };
}

async function startServer() {
  const app = express();
  // Cloud Run and most hosts tell the app which port to use through PORT.
  const PORT = Number(process.env.PORT) || 3000;

  // Selfie frames (JPEG base64) are ~50-150 KB, so the default 100 KB limit is too small.
  app.use(express.json({ limit: '1mb' }));

  /**
   * Trusted Network Time & School Calendar Status API (PRD 6.1 & 10)
   * Returns authoritative server time (UTC + Indian Standard Time YYYY-MM-DD)
   * plus Sunday and school holiday flags.
   */
  app.get('/api/time', (_req, res) => {
    const state = getAuthoritativeSchoolDayState();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.json(state);
  });

  /**
   * UX PRE-CHECK ONLY. This is NOT a security control: it is unauthenticated and
   * the real enforcement happens in POST /api/attendance/mark (server/secureAttendance.ts).
   * Backend Attendance Gatekeeper Function (POST /api/attendance/validate)
   * Checks the authoritative school calendar before any attendance record is created.
   * If the date is a Sunday or a configured holiday, rejects the request with HTTP 403
   * so attendance, streaks, and plant growth are never updated on off-days.
   */
  app.post('/api/attendance/validate', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    const state = getAuthoritativeSchoolDayState();
    const requestedDate: string =
      typeof req.body?.dateId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dateId)
        ? req.body.dateId
        : state.networkDate;

    const customHolidays: Record<string, { label?: string } | string> =
      req.body?.customHolidays && typeof req.body.customHolidays === 'object'
        ? req.body.customHolidays
        : {};

    // 1. Prevent backdating or future-dating against authoritative server date
    if (requestedDate !== state.networkDate) {
      return res.status(403).json({
        allowed: false,
        code: 'DATE_MISMATCH',
        error: `Attendance can only be marked for today's server date (${state.networkDate}).`,
      });
    }

    // 2. Check if the date is a Sunday
    const reqDateObj = new Date(`${requestedDate}T00:00:00Z`);
    const isReqSunday = state.isSunday || reqDateObj.getUTCDay() === 0;
    if (isReqSunday) {
      return res.status(403).json({
        allowed: false,
        code: 'SUNDAY_BLOCKED',
        error: 'Attendance cannot be marked on Sundays. Your streak and plant growth remain safe!',
      });
    }

    // 3. Check if the date is in the school holiday calendar or user's configured holidays
    const builtInHoliday = SCHOOL_CALENDAR_HOLIDAYS[requestedDate];
    const customHolidayEntry = customHolidays[requestedDate];
    const customHolidayLabel =
      typeof customHolidayEntry === 'string'
        ? customHolidayEntry
        : customHolidayEntry?.label;
    const activeHolidayLabel = builtInHoliday || customHolidayLabel;

    if (activeHolidayLabel) {
      return res.status(403).json({
        allowed: false,
        code: 'HOLIDAY_BLOCKED',
        error: `Attendance cannot be marked on a school holiday (${activeHolidayLabel}). Your streak and plant growth remain safe!`,
      });
    }

    return res.status(200).json({
      allowed: true,
      networkDate: state.networkDate,
      isoTimestamp: state.isoTimestamp,
    });
  });

  // Authoritative, token-protected attendance + streak endpoints (see server/secureAttendance.ts)
  registerSecureAttendanceRoutes(app, getAuthoritativeSchoolDayState);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    // dotfiles: 'allow' so /.well-known/assetlinks.json (needed by the Android app) is served.
    app.use(express.static(distPath, { dotfiles: 'allow' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Daily Attendance server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
