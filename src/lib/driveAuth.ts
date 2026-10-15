import firebaseConfig from '../../firebase-applet-config.json';
import { SCOPES } from './firebase';

/**
 * Google Drive access via Google Identity Services (GIS).
 *
 * Signing in with Firebase proves who the student is. Drive needs a separate
 * OAuth access token, which Google only hands out for about an hour and which we
 * deliberately keep in memory only. GIS lets us request a fresh token for a
 * student who already approved Drive, usually without showing any popup.
 *
 * Flow used by the app:
 *   1. silent request   (no UI, runs automatically)
 *   2. interactive request (small consent popup, only from a button click)
 *   3. Firebase popup fallback (handled by the caller)
 */

export interface DriveToken {
  accessToken: string;
  /** Epoch milliseconds when the token stops working. */
  expiresAt: number;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
}

interface GisApi {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        hint?: string;
        prompt?: string;
        callback: (response: GisTokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => GisTokenClient;
    };
  };
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gisLoader: Promise<GisApi | null> | null = null;

function loadGis(): Promise<GisApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const existing = (window as unknown as { google?: GisApi }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  if (gisLoader) return gisLoader;

  gisLoader = new Promise<GisApi | null>((resolve) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () =>
      resolve((window as unknown as { google?: GisApi }).google ?? null);
    script.onerror = () => {
      gisLoader = null; // allow a retry later
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return gisLoader;
}

/**
 * Requests a Drive access token.
 * - interactive: false  -> never shows UI; resolves null if Google needs the student to act.
 * - interactive: true   -> may open Google's consent popup (call it from a click handler).
 */
export async function requestDriveToken(options: {
  loginHint?: string | null;
  interactive: boolean;
}): Promise<DriveToken | null> {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId) return null;

  const gis = await loadGis();
  if (!gis) return null;

  return new Promise<DriveToken | null>((resolve) => {
    let settled = false;
    const finish = (value: DriveToken | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        hint: options.loginHint || undefined,
        callback: (response) => {
          if (response.error || !response.access_token) {
            finish(null);
            return;
          }
          const seconds = Number(response.expires_in) || 3600;
          finish({
            accessToken: response.access_token,
            expiresAt: Date.now() + seconds * 1000,
          });
        },
        error_callback: () => finish(null),
      });

      // 'none' = never show UI. '' = show UI only when Google needs the student to act.
      client.requestAccessToken({ prompt: options.interactive ? '' : 'none' });
    } catch {
      finish(null);
    }

    // Safety net so a silent request can never hang the UI.
    setTimeout(() => finish(null), options.interactive ? 120_000 : 8_000);
  });
}
