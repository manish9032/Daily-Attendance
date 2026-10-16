import fs from 'fs';
import path from 'path';
import type { Express, Request, Response } from 'express';
import { initializeApp, getApps, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import {
  BUILT_IN_SCHOOL_HOLIDAYS,
  evaluateStreakReconciliation,
  getNextFlowerSpecies,
  getPlantStageFromCycleDay,
} from '../src/shared/schoolCalendar';
import type { HolidayItem, UserProfile } from '../src/types';

/**
 * AUTHORITATIVE attendance + streak API.
 *
 * Why this exists: Firestore security rules cannot check face verification or
 * "is today a school day". Before, the browser wrote attendance + streak
 * straight to Firestore, so a student could skip every check from the console.
 * Now ONLY this server (Firebase Admin SDK, bypasses rules) can create
 * attendance records or change streak / plant fields. firestore.rules block
 * those writes from clients.
 */

type SchoolDayState = {
  networkDate: string;
  isoTimestamp: string;
  isSunday: boolean;
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

// ---------- Firebase Admin (lazy, so the server still boots without credentials) ----------

let cachedDb: Firestore | null = null;

function getAdmin(): { db: Firestore } {
  if (cachedDb) return { db: cachedDb };
  const cfg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8')
  ) as { projectId: string; firestoreDatabaseId?: string };

  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    credential = cert(sa);
  } else {
    credential = applicationDefault(); 
  }

  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential, projectId: cfg.projectId });

  cachedDb = cfg.firestoreDatabaseId
    ? getFirestore(app, cfg.firestoreDatabaseId)
    : getFirestore(app);
  return { db: cachedDb };
}

async function requireVerifiedUser(req: Request): Promise<string> {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in again.');
  }
  getAdmin(); // make sure the admin app is initialised before using getAuth()
  try {
    const decoded = await getAuth().verifyIdToken(match[1]);
    if (!decoded.email_verified) {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your Google account email.');
    }
    return decoded.uid;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, 'UNAUTHENTICATED', 'Your session expired. Please sign in again.');
  }
}

// ---------- Helpers ----------

function toIstDate(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Loads the student's custom holidays. A custom holiday only counts if it was
 * created on or before the holiday date itself (IST). This stops a student from
 * adding past missed days as "holidays" afterwards to dodge the wilt/reset rule.
 */
async function loadCustomHolidays(db: Firestore, uid: string): Promise<Record<string, HolidayItem>> {
  const snap = await db.collection('users').doc(uid).collection('holidays').get();
  const out: Record<string, HolidayItem> = {};
  snap.forEach((d) => {
    const data = d.data();
    const created: Date | null = data.createdAt?.toDate?.() ?? null;
    if (created && toIstDate(created) > d.id) return; // declared after the fact -> ignore
    out[d.id] = { dateId: d.id, userId: uid, label: String(data.label || 'Holiday') };
  });
  return out;
}

function assertSchoolDay(
  state: SchoolDayState,
  customHolidays: Record<string, HolidayItem>
): void {
  if (state.isSunday) {
    throw new HttpError(
      403,
      'SUNDAY_BLOCKED',
      'Attendance cannot be marked on Sundays. Your streak and plant growth remain safe!'
    );
  }
  const label =
    BUILT_IN_SCHOOL_HOLIDAYS[state.networkDate] || customHolidays[state.networkDate]?.label;
  if (label) {
    throw new HttpError(
      403,
      'HOLIDAY_BLOCKED',
      `Attendance cannot be marked on a school holiday (${label}). Your streak and plant growth remain safe!`
    );
  }
}

// ---------- Simple in-memory rate limit (per server instance) ----------

const attempts = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 8;

function checkRateLimit(uid: string): void {
  const now = Date.now();
  const recent = (attempts.get(uid) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  }
  recent.push(now);
  attempts.set(uid, recent);
}

// ---------- Face verification (server-side, selfie kept in memory only) ----------

function parseSelfie(input: unknown): string {
  if (typeof input !== 'string') {
    throw new HttpError(400, 'SELFIE_MISSING', 'Selfie frame is missing.');
  }
  const b64 = input.replace(/^data:image\/jpeg;base64,/, '');
  if (b64.length < 4000 || b64.length > 900_000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
    throw new HttpError(400, 'SELFIE_INVALID', 'Selfie frame is invalid or too large.');
  }
  const head = Buffer.from(b64.slice(0, 8), 'base64');
  if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) {
    throw new HttpError(400, 'SELFIE_INVALID', 'Selfie must be a JPEG image.');
  }
  return b64;
}

const FACE_PROMPT = `You are a presence checker for a school attendance app.
Look at this single camera frame and answer ONLY with JSON:
{"faceCount": <integer number of real human faces visible>,
 "faceClearlyVisible": <true if exactly one face is large, well lit, unobstructed and facing the camera>,
 "looksLikePhotoOfScreenOrPrint": <true if the face appears to be a photo shown on another screen, a printed picture, or a poster rather than a live person>}
Do NOT identify anyone. Do not describe the person. JSON only.`;

async function verifyFaceWithGemini(jpegBase64: string): Promise<void> {
  if (process.env.SKIP_FACE_CHECK === 'true' && process.env.NODE_ENV !== 'production') {
    return; // local development only; ignored in production
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new HttpError(
      503,
      'FACE_CHECK_UNAVAILABLE',
      'Face verification is temporarily unavailable. Please try again later.'
    );
  }

  let parsed: { faceCount?: number; faceClearlyVisible?: boolean; looksLikePhotoOfScreenOrPrint?: boolean };
  try {
    const ai = new GoogleGenAI({ apiKey });
    const resp = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
            { text: FACE_PROMPT },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', temperature: 0 },
    });
    parsed = JSON.parse((resp.text || '').replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('Face check failed:', err instanceof Error ? err.message : err);
    // Fail CLOSED: never mark attendance when the check could not run.
    throw new HttpError(
      503,
      'FACE_CHECK_UNAVAILABLE',
      'Face verification is temporarily unavailable. Please try again in a moment.'
    );
  }

  if (parsed.faceCount !== 1 || !parsed.faceClearlyVisible) {
    throw new HttpError(
      422,
      'FACE_NOT_VERIFIED',
      'We could not clearly see exactly one face. Move closer, face the camera in good light and try again.'
    );
  }
  if (parsed.looksLikePhotoOfScreenOrPrint) {
    throw new HttpError(
      422,
      'FACE_NOT_LIVE',
      'This looks like a photo of a screen or print. Please use your live front camera.'
    );
  }
}

// ---------- Route registration ----------

export function registerSecureAttendanceRoutes(
  app: Express,
  getState: () => SchoolDayState
): void {
  const noStore = (res: Response) =>
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  const fail = (res: Response, err: unknown) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ ok: false, code: err.code, error: err.message });
    }
    console.error('Unexpected attendance API error:', err);
    return res
      .status(500)
      .json({ ok: false, code: 'SERVER_ERROR', error: 'Something went wrong. Please try again.' });
  };

  /**
   * POST /api/attendance/mark   (Authorization: Bearer <Firebase ID token>)
   * body: { selfie: <JPEG base64> }
   * Verifies identity, school day, face, then writes the attendance record AND
   * the streak/plant update in ONE transaction. Only the server can do this.
   */
  app.post('/api/attendance/mark', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const uid = await requireVerifiedUser(req);
      const { db } = getAdmin();
      const state = getState();
      const today = state.networkDate;

      const customHolidays = await loadCustomHolidays(db, uid);
      assertSchoolDay(state, customHolidays);

      const selfie = parseSelfie(req.body?.selfie);
      checkRateLimit(uid);

      const profileRef = db.collection('users').doc(uid);
      const preSnap = await profileRef.get();
      if (!preSnap.exists) {
        throw new HttpError(404, 'NO_PROFILE', 'Profile not found. Please finish onboarding first.');
      }
      const pre = preSnap.data() as UserProfile;
      if (!pre.onboardingCompleted || !pre.parentConsentConfirmed) {
        throw new HttpError(
          403,
          'ONBOARDING_REQUIRED',
          'Please finish onboarding and parent consent before marking attendance.'
        );
      }
      if (pre.lastAttendanceDate === today) {
        throw new HttpError(409, 'ALREADY_MARKED', 'Attendance is already marked for today!');
      }

      // The selfie is analysed in memory and never written anywhere.
      await verifyFaceWithGemini(selfie);

      const attRef = profileRef.collection('attendance').doc(today);

      const result = await db.runTransaction(async (tx) => {
        const [pSnap, aSnap] = await Promise.all([tx.get(profileRef), tx.get(attRef)]);
        const profile = pSnap.data() as UserProfile;
        if (aSnap.exists || profile.lastAttendanceDate === today) {
          throw new HttpError(409, 'ALREADY_MARKED', 'Attendance is already marked for today!');
        }

        // Apply any pending wilt / reset FIRST so the streak is never inflated.
        const recon = evaluateStreakReconciliation(profile, today, customHolidays);
        const newStreak = Math.min(10000, recon.currentStreak + 1);
        const newBest = Math.max(profile.bestStreak, newStreak);
        const nextCycleDay = recon.plantCycleDay + 1;
        const completedCycle = nextCycleDay >= 30;
        const stageAtMark = getPlantStageFromCycleDay(Math.min(30, nextCycleDay));

        const badges = [...(profile.earnedBadges || [])];
        let finalCycleDay = nextCycleDay;
        let finalFlower = profile.currentFlowerType;
        if (completedCycle) {
          const entry = `${profile.currentFlowerType}::${today}`;
          if (!badges.includes(entry)) badges.push(entry);
          finalCycleDay = 1;
          finalFlower = getNextFlowerSpecies(profile.currentFlowerType);
        }

        tx.set(attRef, {
          dateId: today,
          userId: uid,
          status: 'present',
          verifiedFace: true,
          networkTimestamp: state.isoTimestamp.slice(0, 40),
          selfieDisposition: 'verified_and_discarded',
          streakAtMark: newStreak,
          plantStageAtMark: stageAtMark,
          createdAt: FieldValue.serverTimestamp(),
        });

        tx.update(profileRef, {
          currentStreak: newStreak,
          bestStreak: newBest,
          lastAttendanceDate: today,
          plantCycleDay: finalCycleDay,
          currentFlowerType: finalFlower,
          plantHealth: 'healthy',
          consecutiveMissedDays: 0,
          earnedBadges: badges.slice(0, 50),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          dateId: today,
          streak: newStreak,
          completedCycle,
          wateredFlower: profile.currentFlowerType,
          newFlower: finalFlower,
        };
      });

      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      return fail(res, err);
    }
  });

  /**
   * POST /api/streak/reconcile   (Authorization: Bearer <Firebase ID token>)
   * Applies wilt / reset rules using SERVER date + holidays. Clients can no
   * longer write these fields themselves.
   */
  app.post('/api/streak/reconcile', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const uid = await requireVerifiedUser(req);
      const { db } = getAdmin();
      const today = getState().networkDate;
      const customHolidays = await loadCustomHolidays(db, uid);
      const profileRef = db.collection('users').doc(uid);

      const updated = await db.runTransaction(async (tx) => {
        const snap = await tx.get(profileRef);
        if (!snap.exists) return false;
        const profile = snap.data() as UserProfile;
        const recon = evaluateStreakReconciliation(profile, today, customHolidays);
        if (!recon.needsUpdate) return false;
        tx.update(profileRef, {
          currentStreak: recon.currentStreak,
          plantCycleDay: recon.plantCycleDay,
          plantHealth: recon.plantHealth,
          consecutiveMissedDays: Math.min(365, recon.consecutiveMissedDays),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });

      return res.status(200).json({ ok: true, updated });
    } catch (err) {
      return fail(res, err);
    }
  });

  /**
   * POST /api/account/delete-attendance   (Authorization: Bearer <Firebase ID token>)
   * "Delete My Data" support. Firestore rules make attendance read-only for clients,
   * so the browser cannot erase it. The server deletes the caller's OWN attendance
   * history so nothing is left behind after account deletion.
   */
  app.post('/api/account/delete-attendance', async (req: Request, res: Response) => {
    noStore(res);
    try {
      const uid = await requireVerifiedUser(req);
      const { db } = getAdmin();
      const col = db.collection('users').doc(uid).collection('attendance');
      let deleted = 0;
      // Delete in chunks (Firestore batches are limited to 500 writes).
      for (;;) {
        const snap = await col.limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
      }
      attempts.delete(uid);
      return res.status(200).json({ ok: true, deleted });
    } catch (err) {
      return fail(res, err);
    }
  });
}
