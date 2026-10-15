import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  Download,
  LogOut,
  ShieldCheck,
  Sprout,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { StudentClassOption, UserProfile } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { playAlarmChime } from '../lib/alarmEngine';

const CLASS_OPTIONS: StudentClassOption[] = [
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
  'College',
];

interface WelcomeSignInViewProps {
  onGoogleLogin: () => Promise<void>;
  isLoggingIn: boolean;
  loginError: string | null;
}

export const WelcomeSignInView: React.FC<WelcomeSignInViewProps> = ({
  onGoogleLogin,
  isLoggingIn,
  loginError,
}) => {
  return (
    <div className="min-h-screen bg-[#F8FAF7] flex flex-col justify-between px-5 py-6 sm:px-8 sm:py-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-4 py-2">
        <span className="text-lg font-bold text-[#111C18] font-display">
          Daily Attendance
        </span>
        <span className="text-xs text-[#52635B]">Student Habit &amp; Document Vault</span>
      </header>

      <main className="max-w-5xl w-full mx-auto my-auto py-10 sm:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-xs font-semibold text-emerald-800">
            Built for School &amp; College Students
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#111C18] leading-tight sm:leading-[1.15]">
            Make showing up every day feel like growing something.
          </h1>
          <p className="text-base text-[#52635B] max-w-xl">
            Build an unbroken daily attendance streak with a living botanical plant, stay ahead of exam deadlines with reliable local alarms, and keep your marksheets &amp; ID proofs under 200 KB in your personal Google Drive.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
              <p className="text-sm font-bold text-[#111C18]">Live Selfie Lock</p>
              <p className="mt-1.5 text-xs text-[#52635B]">
                Live face check with network time. Selfies are never stored.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
              <p className="text-sm font-bold text-[#111C18]">30-Day Plant Cycles</p>
              <p className="mt-1.5 text-xs text-[#52635B]">
                Water your seed daily into a Sunflower, Rose, Lotus, or Orchid.
              </p>
            </div>
            <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
              <p className="text-sm font-bold text-[#111C18]">Under-200 KB Drive Locker</p>
              <p className="mt-1.5 text-xs text-[#52635B]">
                Auto-compresses PDFs &amp; JPEGs directly into your Google Drive.
              </p>
            </div>
          </div>

          {loginError && (
            <div className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3.5 text-sm text-red-800">
              {loginError}
            </div>
          )}

          <div className="pt-2">
            <button
              type="button"
              disabled={isLoggingIn}
              onClick={onGoogleLogin}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    ></path>
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    ></path>
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    ></path>
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    ></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                </span>
              </div>
            </button>
            <p className="mt-4 text-xs text-[#52635B] max-w-sm">
              Asks for minimal Drive permission: the app can only see files it creates for you.
            </p>
          </div>
        </div>

        {/* Right Botanical Preview Card */}
        <div className="lg:col-span-5 rounded-3xl bg-white border border-[#E2E8E0] p-8 text-center shadow-xs">
          <div className="w-20 h-20 rounded-3xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-5">
            <Sprout className="w-10 h-10" />
          </div>
          <h2 className="text-lg font-bold text-[#111C18]">
            Privacy-First Student Sanctuary
          </h2>
          <p className="mt-3 text-sm text-[#52635B]">
            Your attendance selfie is sent securely for a one-time face check (using Google's Gemini AI) and immediately discarded. It is never saved. Your marksheets and admission documents stay in your own Google Drive with zero server storage.
          </p>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto pt-5 text-xs text-[#52635B] flex items-center justify-between border-t border-[#E2E8E0]">
        <span>Daily Attendance v1.0</span>
        <span>Zero-cost student habit &amp; document organizer</span>
      </footer>
    </div>
  );
};

interface OnboardingWizardModalProps {
  profile: UserProfile;
  onCompleteOnboarding: (updates: {
    displayName: string;
    studentClass: StudentClassOption;
    boardExamDate: string;
    parentConsentConfirmed: boolean;
  }) => Promise<void>;
}

export const OnboardingWizardModal: React.FC<OnboardingWizardModalProps> = ({
  profile,
  onCompleteOnboarding,
}) => {
  const [step, setStep] = useState<'profile' | 'permissions'>('profile');
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [studentClass, setStudentClass] = useState<StudentClassOption>(
    (CLASS_OPTIONS.includes(profile.studentClass)
      ? profile.studentClass
      : 'Class 10') as StudentClassOption
  );
  const [cameraReady, setCameraReady] = useState(false);
  const [notifReady, setNotifReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    if ('Notification' in window && Notification.permission === 'granted') {
      return true;
    }
    return localStorage.getItem('daily_attendance_alarms_enabled') === 'true';
  });
  const [saving, setSaving] = useState(false);

  const handleTestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
      });
      stream.getTracks().forEach((t) => t.stop());
      setCameraReady(true);
    } catch {
      setCameraReady(false);
    }
  };

  const handleRequestNotificationPermission = async () => {
    // Unlock Web Audio API context and play confirmation chime for local alarms
    playAlarmChime();
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        await Notification.requestPermission();
      }
    } catch {
      // In cross-origin preview iframes, browser Notification.requestPermission may be restricted;
      // fall back seamlessly to local audio + in-app alarm notifications.
    }
    try {
      localStorage.setItem('daily_attendance_alarms_enabled', 'true');
    } catch {
      // Ignore storage errors
    }
    setNotifReady(true);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await onCompleteOnboarding({
        displayName: displayName.trim() || 'Student',
        studentClass,
        boardExamDate: profile.boardExamDate,
        parentConsentConfirmed: true,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white border border-[#E2E8E0] p-6 shadow-xl">
        {step === 'profile' ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-emerald-700">
                Step 1 of 2 · Student Profile
              </p>
              <h2 className="mt-1 text-xl font-bold text-[#111C18]">
                Set Up Your Study Profile
              </h2>
              <p className="text-xs text-[#52635B] mt-0.5">
                Enter your name and select your current class or college level.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111C18] mb-1">
                Your Name
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3.5 text-sm text-[#111C18]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111C18] mb-1">
                Class / Grade
              </label>
              <div className="grid grid-cols-2 gap-2">
                {CLASS_OPTIONS.map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setStudentClass(cls)}
                    className={`min-h-[44px] rounded-xl border text-xs font-semibold px-3 transition-colors ${
                      studentClass === cls
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-[#F8FAF7] border-[#E2E8E0] text-[#111C18]'
                    }`}
                  >
                    {cls}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={!displayName.trim()}
              onClick={() => setStep('permissions')}
              className="w-full min-h-[48px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
            >
              Continue to Permissions
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-emerald-700">
                Step 2 of 2 · Device Readiness
              </p>
              <h2 className="mt-1 text-xl font-bold text-[#111C18]">
                Enable Camera &amp; Smart Alarms
              </h2>
              <p className="text-xs text-[#52635B] mt-0.5">
                Grant camera access for daily selfie verification and notifications for homework alarms.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#111C18]">
                      Front Camera Access
                    </p>
                    <p className="text-xs text-[#52635B]">
                      Used once per day for live face check
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestCameraPermission}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold ${
                    cameraReady
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-900 text-white'
                  }`}
                >
                  {cameraReady ? 'Ready' : 'Allow'}
                </button>
              </div>

              <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#111C18]">
                      Task &amp; Exam Notifications
                    </p>
                    <p className="text-xs text-[#52635B]">
                      Rings local alarms on deadline time
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRequestNotificationPermission}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold ${
                    notifReady
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-900 text-white'
                  }`}
                >
                  {notifReady ? 'Enabled' : 'Enable'}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep('profile')}
                className="min-h-[48px] px-4 rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleFinish}
                className="flex-1 min-h-[48px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                {saving ? 'Planting Your Seed...' : 'Plant My Seed & Start'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface SettingsModalProps {
  isOpen: boolean;
  profile: UserProfile;
  userEmail: string | null;
  onClose: () => void;
  onSaveProfile: (updates: {
    displayName: string;
    studentClass: StudentClassOption;
    boardExamDate: string;
    parentConsentConfirmed: boolean;
  }) => Promise<void>;
  onSignOut: () => Promise<void>;
  onDeleteMyData: () => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  profile,
  userEmail,
  onClose,
  onSaveProfile,
  onSignOut,
  onDeleteMyData,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [studentClass, setStudentClass] = useState<StudentClassOption>(
    (CLASS_OPTIONS.includes(profile.studentClass)
      ? profile.studentClass
      : 'Class 10') as StudentClassOption
  );
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveProfile({
        displayName: displayName.trim() || 'Student',
        studentClass,
        boardExamDate: profile.boardExamDate,
        parentConsentConfirmed: true,
      });
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white border border-[#E2E8E0] p-5 sm:p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#E2E8E0]">
          <div>
            <h2 className="text-lg font-bold text-[#111C18]">
              Profile, Privacy &amp; Settings
            </h2>
            <p className="text-xs text-[#52635B]">{userEmail || 'Signed in with Google'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#52635B] hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#111C18] mb-1">
                Student Name
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3.5 text-sm text-[#111C18]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#111C18] mb-1">
                Class / Grade
              </label>
              <select
                value={studentClass}
                onChange={(e) =>
                  setStudentClass(e.target.value as StudentClassOption)
                }
                className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3 text-sm text-[#111C18]"
              >
                {CLASS_OPTIONS.map((cls) => (
                  <option key={cls} value={cls}>
                    {cls}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[44px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            <UserCheck className="w-4 h-4" />
            <span>
              {saving
                ? 'Saving Profile...'
                : savedToast
                ? 'Profile Saved!'
                : 'Save Profile Settings'}
            </span>
          </button>
        </form>

        {/* PWA Install Prompt if available */}
        {!isInstalled && isInstallable && (
          <div className="mt-5 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-emerald-950">
                Install App to Home Screen
              </p>
              <p className="text-xs text-emerald-800">
                Launch in under 2 seconds and keep offline task alarms active.
              </p>
            </div>
            <button
              type="button"
              onClick={install}
              className="min-h-[40px] px-3.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
          </div>
        )}

        {/* Account Actions: Sign Out & Delete My Data */}
        <div className="mt-5 pt-4 border-t border-[#E2E8E0] flex flex-col sm:flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSignOut}
            className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-[#E2E8E0] text-xs font-semibold text-[#111C18] hover:bg-slate-50 flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>

          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete My Data</span>
          </button>
        </div>

        {/* Delete My Data Confirmation Dialog */}
        {confirmDeleteOpen && (
          <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-950">
                  Delete Profile, Tasks &amp; Holidays?
                </p>
                <p className="text-xs text-red-800 mt-0.5">
                  This will remove your profile, tasks, and custom holidays from the app and sign you out. Documents in your personal Google Drive remain untouched unless deleted in the Locker.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="flex-1 min-h-[40px] rounded-xl bg-white border border-red-200 text-xs font-semibold text-[#111C18]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingData}
                onClick={async () => {
                  setIsDeletingData(true);
                  try {
                    await onDeleteMyData();
                  } finally {
                    setIsDeletingData(false);
                  }
                }}
                className="flex-1 min-h-[40px] rounded-xl bg-red-600 text-white text-xs font-semibold"
              >
                {isDeletingData ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
