# Daily Attendance — Student Habit + Locker

Gamified student assistant app: live-selfie attendance, plant streak, smart to-do alarms and a Google Drive document locker.

## Run locally

**Prerequisites:** Node.js 20+

1. `npm install`
2. Copy `.env.example` to `.env.local` and set `GEMINI_API_KEY` (used by the **server** for the face check).
3. Give the server Firebase Admin access (needed to write attendance):
   - `gcloud auth application-default login`, **or**
   - set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON (never commit it).
   - For quick UI-only testing you can set `SKIP_FACE_CHECK="true"` (ignored in production).
4. `npm run dev`

## How attendance is secured

The browser can no longer write attendance or streaks directly.

1. Student takes a live selfie. A quick on-device check gives instant feedback (UX only).
2. The app sends one JPEG frame + the Firebase ID token to `POST /api/attendance/mark`.
3. The server verifies the token, the Sunday/holiday calendar (server time, IST), rate limits attempts, and checks the face with Gemini. The image is analysed in memory and never stored.
4. In one Firestore transaction the server writes the attendance record and the streak/plant update.
5. `firestore.rules` deny client writes to attendance and to streak/plant fields.

`POST /api/streak/reconcile` applies the wilt / reset rules with the same server logic (`src/shared/schoolCalendar.ts`, shared by client and server).

## Deploy checklist

- Deploy the updated `firestore.rules`  (`firebase deploy --only firestore:rules`). **Without this step the old, insecure rules stay active and the new server API is not enforced.**
- Set `GEMINI_API_KEY` on the server. If it is missing, attendance fails closed (nobody can mark).
- The server must run with credentials that can write to Firestore (Cloud Run service account is fine).

## Deploy (Google Cloud Run)

```
gcloud run deploy daily-attendance --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars GEMINI_API_KEY=your_key
```

Then:
- Give the Cloud Run service account the **Cloud Datastore User** role (the server writes attendance with it).
- Add the Cloud Run URL to Firebase Console > Authentication > Settings > Authorized domains.
- Add the same URL to the Google OAuth client's Authorized JavaScript origins (see below).
- Run `firebase deploy --only firestore:rules`.

## Android APK

The app is a PWA with PNG icons, so it can be packaged as an Android app once it is hosted:

1. Open https://www.pwabuilder.com, enter your Cloud Run URL and choose **Package for stores > Android**.
2. Download the package, keep the signing keystore somewhere safe, and attach the `.apk` to a GitHub Release.
3. PWABuilder also gives you an `assetlinks.json`. Save it as `public/.well-known/assetlinks.json`, redeploy, and the app opens full screen without a browser bar.

## Google Drive access (Locker)

Signing in proves who the student is. Drive needs its own short-lived token, so the app
requests it automatically through Google Identity Services and renews it in the background.
Students only see a "Connect Google Drive" button if Google needs them to act.

One-time setup in Google Cloud Console (APIs & Services > Credentials > the Web OAuth client from
`firebase-applet-config.json` > Authorized JavaScript origins): add `http://localhost:3000` and your
deployed app URL. If an origin is missing, the app quietly falls back to the Firebase sign-in popup.

## Known limits

- The face check proves "a clear live-looking face is in the frame", not *who* it is. A student could still show a friend's face. A gesture challenge or teacher verification would be the next step.
- Rate limiting is in-memory (per server instance).
- "Delete My Data" now also erases attendance history through the server (`/api/account/delete-attendance`).
- Web alarms rely on the browser/PWA being alive; for guaranteed alarms use push notifications (FCM) or a native wrapper.
- The selfie frame is sent to the Gemini API for analysis. Mention this in your privacy policy / parent consent text, and use a paid-tier API key so Google does not use the data for training.
