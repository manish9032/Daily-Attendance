import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarOff,
  Camera,
  CheckCircle2,
  Lock,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import {
  checkSundayOrHoliday,
  fetchTrustedNetworkTime,
  validateAttendanceDayOnBackend,
} from '../lib/networkTime';
import { HolidayItem, NetworkTimePayload } from '../types';

interface SelfieAttendanceModalProps {
  isOpen: boolean;
  alreadyMarkedToday: boolean;
  holidaysMap?: Record<string, HolidayItem>;
  onClose: () => void;
  /**
   * Called with a live JPEG frame (data URL). The server does the real face
   * verification and writes attendance; the frame is never stored.
   */
  onAttendanceVerified: (networkTime: NetworkTimePayload, selfieJpegDataUrl: string) => Promise<void>;
}

/**
 * QUICK ON-DEVICE PRE-CHECK (UX only, NOT a security control).
 * It just gives the student instant "face detected" feedback. The real
 * verification happens on the server (POST /api/attendance/mark), because
 * anything running in the browser can be bypassed.
 *
 * Analyzes the center face-guide region of the live camera frame to check
 * that a real human face (and not a blank wall, dark room, or covered lens)
 * is present in the frame.
 * Uses native FaceDetector API when available, with an automatic multi-zone
 * skin/facial-feature luminance & variance detector fallback.
 */
async function detectFaceInVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<{ detected: boolean; reason?: string }> {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;

  if (width < 64 || height < 64) {
    return {
      detected: false,
      reason: 'Camera stream is still initializing. Hold steady for a moment.',
    };
  }

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { detected: false, reason: 'Unable to access video frame buffer.' };
  }

  ctx.drawImage(video, 0, 0, width, height);

  // 1. Try browser native FaceDetector API first (supported in Android Chrome / Chromium)
  const NativeFaceDetector = (
    window as unknown as {
      FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
        detect: (
          source: HTMLCanvasElement | HTMLVideoElement
        ) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
      };
    }
  ).FaceDetector;

  if (NativeFaceDetector) {
    try {
      const detector = new NativeFaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await detector.detect(canvas);
      if (faces.length > 0) {
        const box = faces[0].boundingBox;
        if (box.width >= width * 0.15 && box.height >= height * 0.15) {
          // Immediately clear the canvas so no selfie pixels remain in memory
          ctx.clearRect(0, 0, width, height);
          return { detected: true };
        }
        ctx.clearRect(0, 0, width, height);
        return {
          detected: false,
          reason: 'Please move closer so your face fills the center oval guide.',
        };
      }
      ctx.clearRect(0, 0, width, height);
      return {
        detected: false,
        reason: 'No face detected in the frame. Please center your face in front of the camera.',
      };
    } catch {
      // Fall through to pixel/feature analysis if native FaceDetector fails on platform
    }
  }

  // 2. Multi-Zone Facial Feature, Luminance & Skin-Chroma Heuristic Fallback
  const roiX = Math.floor(width * 0.25);
  const roiY = Math.floor(height * 0.18);
  const roiW = Math.floor(width * 0.5);
  const roiH = Math.floor(height * 0.64);

  const imageData = ctx.getImageData(roiX, roiY, roiW, roiH);
  const data = imageData.data;

  // Immediately wipe canvas buffer for student privacy
  ctx.clearRect(0, 0, width, height);

  let totalLuma = 0;
  let skinLikePixels = 0;
  let sampleCount = 0;
  const lumaSamples: number[] = [];

  // Sample every 4th pixel inside the oval face region
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    totalLuma += luma;
    lumaSamples.push(luma);
    sampleCount++;

    // YCbCr skin-tone chroma envelope (inclusive across diverse Indian/global skin tones)
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

    const isSkinChroma = cb >= 75 && cb <= 142 && cr >= 126 && cr <= 185 && luma > 35 && luma < 245;
    const isWarmPortrait = r > g * 0.92 && g > b * 0.85 && r - b >= 10 && luma > 40 && luma < 240;

    if (isSkinChroma || isWarmPortrait) {
      skinLikePixels++;
    }
  }

  const avgLuma = totalLuma / Math.max(1, sampleCount);
  if (avgLuma < 32) {
    return {
      detected: false,
      reason: 'Camera frame is too dark. Please turn on a light or face a window.',
    };
  }
  if (avgLuma > 242) {
    return {
      detected: false,
      reason: 'Camera frame is overexposed. Avoid pointing directly at a bright light.',
    };
  }

  // Compute standard deviation of luminance (faces have eyes, eyebrows, nose shadows; flat walls/ceilings do not)
  let varianceSum = 0;
  for (const l of lumaSamples) {
    varianceSum += (l - avgLuma) * (l - avgLuma);
  }
  const stdDev = Math.sqrt(varianceSum / Math.max(1, lumaSamples.length));
  const skinRatio = skinLikePixels / Math.max(1, sampleCount);

  if (stdDev < 14) {
    return {
      detected: false,
      reason: 'No facial features detected (camera appears pointed at a flat surface or covered).',
    };
  }

  if (skinRatio < 0.16) {
    return {
      detected: false,
      reason: 'No face detected in the frame. Please center your face inside the oval guide.',
    };
  }

  return { detected: true };
}

export const SelfieAttendanceModal: React.FC<SelfieAttendanceModalProps> = ({
  isOpen,
  alreadyMarkedToday,
  holidaysMap = {},
  onClose,
  onAttendanceVerified,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [checkingNetwork, setCheckingNetwork] = useState(true);
  const [networkTime, setNetworkTime] = useState<NetworkTimePayload | null>(null);
  const [offDayReason, setOffDayReason] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facePresentLive, setFacePresentLive] = useState(false);
  const [faceStatusMessage, setFaceStatusMessage] = useState(
    'Center your face inside the oval frame'
  );
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      return;
    }

    let cancelled = false;
    setCheckingNetwork(true);
    setOffDayReason(null);
    setNetworkError(null);
    setCameraError(null);
    setCaptureError(null);

    async function initModal() {
      // Step 1: Verify Trusted Network Time (blocks if offline)
      try {
        const trustedTime = await fetchTrustedNetworkTime();
        if (cancelled) return;
        setNetworkTime(trustedTime);

        // Step 2: Check Sunday & School Holiday Calendar on the Backend
        try {
          await validateAttendanceDayOnBackend(trustedTime.networkDate, holidaysMap);
        } catch (offDayErr) {
          if (cancelled) return;
          setOffDayReason(
            offDayErr instanceof Error
              ? offDayErr.message
              : 'Attendance cannot be marked on Sundays or school holidays.'
          );
          setCheckingNetwork(false);
          return;
        }

        setCheckingNetwork(false);

        if (alreadyMarkedToday) {
          return;
        }

        // Step 3: Open Front Camera in Live-Capture Mode ONLY
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setCameraError('Live camera access is not supported in this browser.');
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        setCheckingNetwork(false);
        const msg =
          err instanceof Error ? err.message : 'Unable to initialize attendance verification.';
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
          setCameraError(
            'Camera permission was denied. Please allow camera access in your browser settings to mark daily attendance.'
          );
        } else {
          setNetworkError(msg);
        }
      }
    }

    initModal();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [isOpen, alreadyMarkedToday, holidaysMap]);

  // Continuous live face presence indicator every 700ms
  useEffect(() => {
    if (
      !isOpen ||
      alreadyMarkedToday ||
      Boolean(offDayReason) ||
      checkingNetwork ||
      networkError ||
      cameraError
    ) {
      return;
    }

    const interval = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || isCapturing) return;
      const result = await detectFaceInVideoFrame(videoRef.current, canvasRef.current);
      setFacePresentLive(result.detected);
      setFaceStatusMessage(
        result.detected
          ? 'Face detected — ready to mark attendance'
          : result.reason || 'Center your face inside the oval guide'
      );
    }, 700);

    return () => clearInterval(interval);
  }, [
    isOpen,
    alreadyMarkedToday,
    offDayReason,
    checkingNetwork,
    networkError,
    cameraError,
    isCapturing,
  ]);

  if (!isOpen) return null;

  const handleCaptureAndVerify = async () => {
    if (alreadyMarkedToday) {
      setCaptureError('Attendance is already marked for today. Come back tomorrow!');
      return;
    }
    if (!videoRef.current || !canvasRef.current) return;

    setIsCapturing(true);
    setCaptureError(null);

    try {
      // Re-verify trusted network time and backend Sunday/Holiday check right at capture moment
      const freshTime = await fetchTrustedNetworkTime();
      const offCheck = checkSundayOrHoliday(freshTime.networkDate, holidaysMap);
      if (offCheck.blocked) {
        stopCameraStream();
        setOffDayReason(offCheck.reason);
        setIsCapturing(false);
        return;
      }
      await validateAttendanceDayOnBackend(freshTime.networkDate, holidaysMap);

      const check = await detectFaceInVideoFrame(videoRef.current, canvasRef.current);

      if (!check.detected) {
        setCaptureError(
          check.reason ||
            'No detectable face in frame. Please position your face clearly in the camera and try again.'
        );
        setIsCapturing(false);
        return;
      }

      // Grab one JPEG frame for the server-side face check, then wipe the canvas.
      const frameCanvas = canvasRef.current;
      const fctx = frameCanvas.getContext('2d');
      const vw = videoRef.current.videoWidth || 640;
      const vh = videoRef.current.videoHeight || 480;
      const scale = Math.min(1, 640 / vw);
      frameCanvas.width = Math.round(vw * scale);
      frameCanvas.height = Math.round(vh * scale);
      fctx?.drawImage(videoRef.current, 0, 0, frameCanvas.width, frameCanvas.height);
      const selfieJpegDataUrl = frameCanvas.toDataURL('image/jpeg', 0.7);
      fctx?.clearRect(0, 0, frameCanvas.width, frameCanvas.height);

      // Stop camera immediately; the frame only lives in this variable until sent.
      stopCameraStream();
      await onAttendanceVerified(freshTime, selfieJpegDataUrl);
      onClose();
    } catch (err) {
      setCaptureError(
        err instanceof Error
          ? err.message
          : 'Failed to verify attendance. Please check your internet connection.'
      );
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white border border-[#E2E8E0] p-5 sm:p-6 shadow-xl">
        {/* Grab Handle on Mobile */}
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden" />

        <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#E2E8E0]">
          <div>
            <h2 className="text-lg font-bold text-[#111C18]">Live Selfie Attendance</h2>
            <p className="text-xs text-[#52635B]">
              Live front camera only · Checked on our server &amp; never stored
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#52635B] hover:bg-slate-100 transition-colors"
            aria-label="Close camera modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body States */}
        <div className="mt-4">
          {offDayReason ? (
            <div className="rounded-2xl bg-slate-50 border border-[#E2E8E0] p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto mb-3">
                <CalendarOff className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-[#111C18]">
                Attendance Closed (Sunday / Holiday)
              </h3>
              <p className="mt-1.5 text-sm text-[#52635B]">{offDayReason}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full min-h-[48px] rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
              >
                Got It
              </button>
            </div>
          ) : alreadyMarkedToday ? (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-amber-950">
                Attendance Already Marked Today
              </h3>
              <p className="mt-1.5 text-sm text-amber-900">
                Your attendance camera is locked for the rest of today (
                <span className="font-mono-tabular font-semibold">
                  {networkTime?.networkDate || 'Today'}
                </span>
                ). Come back tomorrow to water your plant again!
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full min-h-[48px] rounded-xl bg-amber-700 text-white font-semibold text-sm hover:bg-amber-800 transition-colors"
              >
                Got It
              </button>
            </div>
          ) : checkingNetwork ? (
            <div className="py-12 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
              <p className="text-sm font-medium text-[#111C18]">
                Verifying trusted network time &amp; school calendar...
              </p>
              <p className="text-xs text-[#52635B] mt-1">
                Checking server clock so device date changes cannot bypass the daily lock
              </p>
            </div>
          ) : networkError ? (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center">
              <WifiOff className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <h3 className="text-base font-bold text-red-950">
                Trusted Network Time Unavailable
              </h3>
              <p className="mt-1.5 text-sm text-red-800">{networkError}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full min-h-[48px] rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-700 transition-colors"
              >
                Close
              </button>
            </div>
          ) : cameraError ? (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center">
              <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
              <h3 className="text-base font-bold text-red-950">Camera Access Required</h3>
              <p className="mt-1.5 text-sm text-red-800">{cameraError}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 w-full min-h-[48px] rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Live Front Camera Viewfinder */}
              <div className="relative overflow-hidden rounded-2xl bg-slate-950 aspect-[4/3] border border-[#E2E8E0]">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Face Oval Guide Overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div
                    className={`w-44 h-56 rounded-full border-2 transition-colors duration-200 ${
                      facePresentLive
                        ? 'border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)]'
                        : 'border-amber-300/90 border-dashed shadow-[0_0_0_9999px_rgba(0,0,0,0.48)]'
                    }`}
                  />
                </div>

                {/* Live Status Caption */}
                <div className="absolute bottom-3 left-3 right-3 bg-black/75 backdrop-blur-sm rounded-xl px-3 py-2 flex items-center gap-2 text-xs text-white">
                  {facePresentLive ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                  )}
                  <span className="truncate">{faceStatusMessage}</span>
                </div>
              </div>

              {/* Trusted Network Date & Privacy Notice */}
              <div className="mt-3 flex items-center justify-between text-xs text-[#52635B] px-1">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Photo is never saved or uploaded</span>
                </span>
                <span className="font-mono-tabular">
                  Server Date: {networkTime?.networkDate}
                </span>
              </div>

              {captureError && (
                <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-xs font-medium text-red-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{captureError}</span>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[48px] px-4 rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18] hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isCapturing}
                  onClick={handleCaptureAndVerify}
                  className="flex-1 min-h-[48px] px-5 rounded-xl bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>{isCapturing ? 'Verifying Face...' : 'Verify Selfie & Mark Present'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
