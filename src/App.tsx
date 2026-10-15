/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import {
  AlarmClock,
  AlertTriangle,
  Award,
  BellRing,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Droplets,
  Flame,
  FolderLock,
  Home,
  Lock,
  Plus,
  Settings,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import {
  AttendanceRecord,
  HolidayItem,
  NetworkTimePayload,
  StudentClassOption,
  TaskItem,
  UserProfile,
} from './types';
import {
  createHolidayItem,
  createTaskItem,
  deleteAllUserData,
  deleteHolidayItem,
  deleteTaskItem,
  fetchOrCreateUserProfile,
  googleSignIn,
  initAuth,
  logout,
  setCachedAccessToken,
  subscribeToAttendance,
  subscribeToHolidays,
  subscribeToTasks,
  subscribeToUserProfile,
  updateProfileSettings,
  updateTaskDetails,
  updateTaskStatusOrSnooze,
} from './lib/firebase';
import {
  fetchTrustedNetworkTime,
  getPlantStageFromCycleDay,
} from './lib/networkTime';
import {
  getCachedTasksForAlarms,
  hasAlarmFiredRecently,
  markAlarmFiredForSignature,
  playAlarmChime,
  syncTasksToLocalAlarmCache,
  triggerSystemAlarmNotification,
} from './lib/alarmEngine';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { DriveToken, requestDriveToken } from './lib/driveAuth';
import {
  deleteAttendanceHistoryOnServer,
  markAttendanceOnServer,
  reconcileStreakOnServer,
} from './lib/attendanceApi';
import { PlantIllustration } from './components/PlantIllustration';
import { SelfieAttendanceModal } from './components/SelfieAttendanceModal';
import { HistoryCalendarView } from './components/HistoryCalendarView';
import { SmartTodoView } from './components/SmartTodoView';
import { DocumentLockerView } from './components/DocumentLockerView';
import {
  OnboardingWizardModal,
  SettingsModal,
  WelcomeSignInView,
} from './components/OnboardingAndSettings';

type NavTab = 'home' | 'calendar' | 'todo' | 'locker';

export default function App() {
  const isOnline = useOnlineStatus();

  // Auth & Profile state
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [driveConnecting, setDriveConnecting] = useState(false);
  const driveExpiryRef = useRef<number>(0);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Firestore synced entities
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [attendanceMap, setAttendanceMap] = useState<Record<string, AttendanceRecord>>({});
  const [tasks, setTasks] = useState<TaskItem[]>(() => getCachedTasksForAlarms());
  const [holidaysMap, setHolidaysMap] = useState<Record<string, HolidayItem>>({});

  // Trusted network time
  const [networkTime, setNetworkTime] = useState<NetworkTimePayload | null>(null);
  const [networkDate, setNetworkDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  // Navigation & Modals
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [isSelfieModalOpen, setIsSelfieModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWatering, setIsWatering] = useState(false);
  const [attendanceBanner, setAttendanceBanner] = useState<string | null>(null);

  // Active Ringing Alarm Modal
  const [ringingTask, setRingingTask] = useState<TaskItem | null>(null);

  // Register Service Worker on mount
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Fetch Trusted Network Time on boot and periodically
  const refreshNetworkTime = useCallback(async () => {
    try {
      const trusted = await fetchTrustedNetworkTime();
      setNetworkTime(trusted);
      setNetworkDate(trusted.networkDate);
      return trusted;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshNetworkTime();
    const timer = setInterval(refreshNetworkTime, 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshNetworkTime]);

  // Default board exam date (March 1st of upcoming exam cycle)
  const defaultBoardExamDate = useMemo(() => {
    const year = Number(networkDate.slice(0, 4)) || 2027;
    const month = Number(networkDate.slice(5, 7)) || 10;
    const targetYear = month >= 3 ? year + 1 : year;
    return `${targetYear}-02-15`;
  }, [networkDate]);

  // Initialize Firebase Auth Listener
  useEffect(() => {
    const unsub = initAuth(async (user, token) => {
      setCurrentUser(user);
      if (token) setAccessToken(token);
      if (user) {
        try {
          await fetchOrCreateUserProfile(user, defaultBoardExamDate);
        } catch (err) {
          console.error('Profile initialization error:', err);
        }
      } else {
        setProfile(null);
        setAttendanceMap({});
        setHolidaysMap({});
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [defaultBoardExamDate]);

  // Attach Firestore Snapshot Listeners when user is authenticated
  useEffect(() => {
    if (!authReady || !currentUser) return;

    const unsubProfile = subscribeToUserProfile(currentUser.uid, (p) => {
      setProfile(p);
    });
    const unsubAttendance = subscribeToAttendance(currentUser.uid, (map) => {
      setAttendanceMap(map);
    });
    const unsubTasks = subscribeToTasks(currentUser.uid, (items) => {
      setTasks(items);
      syncTasksToLocalAlarmCache(items);
    });
    const unsubHolidays = subscribeToHolidays(currentUser.uid, (map) => {
      setHolidaysMap(map);
    });

    return () => {
      unsubProfile();
      unsubAttendance();
      unsubTasks();
      unsubHolidays();
    };
  }, [authReady, currentUser]);

  // Reconcile streak & plant wilting state. The SERVER is the authority (it also ignores
  // custom holidays that were added after the fact), so we ask it once per school date
  // instead of trusting the browser's own calculation.
  const reconciledDateRef = useRef<string>('');
  useEffect(() => {
    if (!profile || !networkTime || !currentUser) return;
    const key = `${currentUser.uid}:${networkTime.networkDate}:${profile.lastAttendanceDate}`;
    if (reconciledDateRef.current === key) return;
    reconciledDateRef.current = key;

    reconcileStreakOnServer().catch((err) => {
      console.error('Streak reconcile failed:', err);
      reconciledDateRef.current = ''; // allow a retry on the next profile update
    });
  }, [profile, networkTime, currentUser]);

  // Connect Google Drive automatically (no popup) once the student is signed in, and
  // renew the token quietly before it expires. If Google needs the student to act,
  // the Locker shows a single "Connect Google Drive" button instead.
  useEffect(() => {
    if (!currentUser) return;
    const hint = currentUser.email ?? null;
    let cancelled = false;
    let timer: number | undefined;

    const scheduleRenewal = (expiresAt: number) => {
      const delay = Math.max(30_000, expiresAt - Date.now() - 5 * 60 * 1000);
      timer = window.setTimeout(async () => {
        const next = await requestDriveToken({ loginHint: hint, interactive: false });
        if (cancelled) return;
        if (next) {
          applyDriveToken(next);
          scheduleRenewal(next.expiresAt);
        } else {
          setAccessToken(null); // ask the student to reconnect from the Locker
        }
      }, delay);
    };

    const connect = async () => {
      setDriveConnecting(true);
      const token = await requestDriveToken({ loginHint: hint, interactive: false });
      if (cancelled) return;
      setDriveConnecting(false);
      if (token) {
        applyDriveToken(token);
        scheduleRenewal(token.expiresAt);
      }
    };

    if (accessToken) {
      // Token came from the sign-in popup; it lasts about an hour.
      const expiresAt = driveExpiryRef.current || Date.now() + 55 * 60 * 1000;
      driveExpiryRef.current = expiresAt;
      scheduleRenewal(expiresAt);
    } else {
      connect();
    }

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // Re-run only when the signed-in student changes or the token is lost/replaced.
  }, [currentUser?.uid, accessToken === null]);

  // Local Task Alarm Monitor (checks every 10 seconds)
  useEffect(() => {
    const checkAlarms = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const localYYYY = now.getFullYear();
      const localMM = String(now.getMonth() + 1).padStart(2, '0');
      const localDD = String(now.getDate()).padStart(2, '0');
      const localDateStr = `${localYYYY}-${localMM}-${localDD}`;
      const localHH = String(now.getHours()).padStart(2, '0');
      const localMin = String(now.getMinutes()).padStart(2, '0');
      const localTimeStr = `${localHH}:${localMin}`;

      for (const task of tasks) {
        if (task.completed || !task.alarmEnabled) continue;

        // 1. Check if a snoozed alarm has reached its snoozedUntil timestamp
        if (task.snoozedUntil) {
          const snoozeTarget = new Date(task.snoozedUntil).getTime();
          const sig = `${task.taskId}::snooze::${task.snoozedUntil}`;
          if (
            nowMs >= snoozeTarget &&
            nowMs - snoozeTarget <= 5 * 60 * 1000 &&
            !hasAlarmFiredRecently(sig)
          ) {
            markAlarmFiredForSignature(sig);
            setRingingTask(task);
            playAlarmChime();
            triggerSystemAlarmNotification(task);
            break;
          }
          continue;
        }

        // 2. Check if due date and time match current minute (or within 1 minute window)
        const matchesDate =
          task.dueDate === localDateStr || task.dueDate === networkDate;
        if (matchesDate && task.dueTime === localTimeStr) {
          const sig = `${task.taskId}::${task.dueDate}::${task.dueTime}`;
          if (!hasAlarmFiredRecently(sig)) {
            markAlarmFiredForSignature(sig);
            setRingingTask(task);
            playAlarmChime();
            triggerSystemAlarmNotification(task);
            break;
          }
        }
      }
    };

    checkAlarms();
    const interval = setInterval(checkAlarms, 10000);
    return () => clearInterval(interval);
  }, [tasks, networkDate]);

  // Listen for Service Worker notification clicks
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ALARM_NOTIFICATION_ACTION') {
        const found = tasks.find((t) => t.taskId === event.data.taskId);
        if (found) {
          setRingingTask(found);
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [tasks]);

  // Auth Handlers
  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setCurrentUser(res.user);
        setAccessToken(res.accessToken);
      }
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In was cancelled or failed. Please try again.'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const applyDriveToken = useCallback((token: DriveToken) => {
    driveExpiryRef.current = token.expiresAt;
    setCachedAccessToken(token.accessToken);
    setAccessToken(token.accessToken);
  }, []);

  // Runs from a button click. Google only shows a prompt if the student must act;
  // a student who already approved Drive usually gets the token with no prompt at all.
  const handleReconnectDrive = async (): Promise<string | null> => {
    setDriveConnecting(true);
    try {
      const hint = currentUser?.email ?? null;
      const token = await requestDriveToken({ loginHint: hint, interactive: true });
      if (token) {
        applyDriveToken(token);
        return token.accessToken;
      }
      // Fallback: the original Firebase popup, with the student's account preselected.
      const res = await googleSignIn({ loginHint: hint });
      if (res?.accessToken) {
        driveExpiryRef.current = Date.now() + 55 * 60 * 1000;
        setAccessToken(res.accessToken);
        return res.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      setDriveConnecting(false);
    }
  };

  const alreadyMarkedToday = Boolean(
    profile &&
      (profile.lastAttendanceDate === networkDate || attendanceMap[networkDate])
  );

  // Mark Daily Attendance: the SERVER verifies the face + school day and writes
  // attendance, streak and plant state in one transaction.
  const handleAttendanceVerified = async (
    freshNetworkTime: NetworkTimePayload,
    selfieJpegDataUrl: string
  ) => {
    if (!currentUser || !profile) return;

    const todayStr = freshNetworkTime.networkDate;
    if (attendanceMap[todayStr] || profile.lastAttendanceDate === todayStr) {
      setAttendanceBanner('Attendance is already marked for today!');
      return;
    }

    const result = await markAttendanceOnServer(selfieJpegDataUrl);

    // Profile + attendance history refresh automatically via the Firestore listeners.
    setIsWatering(true);
    if (result.completedCycle) {
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
      });
      setAttendanceBanner(
        `30-Day Cycle Complete! You earned the ${result.wateredFlower} Badge and started growing a ${result.newFlower}!`
      );
    } else {
      setAttendanceBanner(
        `Attendance marked for ${result.dateId}! Your ${result.wateredFlower} was watered (${result.streak}-day streak).`
      );
    }

    setTimeout(() => {
      setIsWatering(false);
    }, 3800);
  };

  // Task CRUD Handlers
  const handleCreateTask = async (
    newTask: Omit<TaskItem, 'taskId' | 'userId' | 'createdAt' | 'updatedAt'>
  ) => {
    if (!currentUser) return;
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await createTaskItem({
      ...newTask,
      taskId,
      userId: currentUser.uid,
    });
  };

  const handleUpdateTask = async (
    taskId: string,
    updates: Pick<
      TaskItem,
      | 'title'
      | 'notes'
      | 'dueDate'
      | 'dueTime'
      | 'category'
      | 'completed'
      | 'alarmEnabled'
      | 'snoozedUntil'
    >
  ) => {
    if (!currentUser) return;
    await updateTaskDetails(currentUser.uid, taskId, updates);
  };

  const handleToggleTaskDone = async (task: TaskItem) => {
    if (!currentUser) return;
    await updateTaskStatusOrSnooze(
      currentUser.uid,
      task.taskId,
      !task.completed,
      ''
    );
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!currentUser) return;
    await deleteTaskItem(currentUser.uid, taskId);
  };

  // Alarm Snooze & Mark-Done Actions
  const handleSnoozeRingingTask = async (minutes: number) => {
    if (!ringingTask || !currentUser) return;
    const snoozeIso = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const taskId = ringingTask.taskId;
    setRingingTask(null);
    await updateTaskStatusOrSnooze(currentUser.uid, taskId, false, snoozeIso);
  };

  const handleMarkDoneFromAlarm = async () => {
    if (!ringingTask || !currentUser) return;
    const taskId = ringingTask.taskId;
    setRingingTask(null);
    await updateTaskStatusOrSnooze(currentUser.uid, taskId, true, '');
  };

  // Holiday Handlers
  const handleAddHoliday = async (dateId: string, label: string) => {
    if (!currentUser) return;
    await createHolidayItem(currentUser.uid, dateId, label);
  };

  const handleDeleteHoliday = async (dateId: string) => {
    if (!currentUser) return;
    await deleteHolidayItem(currentUser.uid, dateId);
  };

  // Onboarding & Profile Settings
  const handleSaveProfileSettings = async (updates: {
    displayName: string;
    studentClass: StudentClassOption;
    boardExamDate: string;
    parentConsentConfirmed: boolean;
  }) => {
    if (!currentUser) return;
    await updateProfileSettings(currentUser.uid, {
      ...updates,
      onboardingCompleted: true,
    });
  };

  const handleDeleteAllData = async () => {
    if (!currentUser) return;
    // Attendance is read-only for clients, so the server erases it first.
    await deleteAttendanceHistoryOnServer();
    await deleteAllUserData(currentUser.uid);
    await logout();
    setIsSettingsOpen(false);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F8FAF7] flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto mb-3 font-bold">
            DA
          </div>
          <p className="text-sm font-semibold text-[#111C18]">
            Loading Daily Attendance...
          </p>
        </div>
      </div>
    );
  }

  if (!currentUser || !profile) {
    return (
      <WelcomeSignInView
        onGoogleLogin={handleGoogleLogin}
        isLoggingIn={isLoggingIn}
        loginError={loginError}
      />
    );
  }

  const currentStage = getPlantStageFromCycleDay(profile.plantCycleDay);
  const todaysTasks = tasks.filter((t) => !t.completed).slice(0, 4);

  return (
    <div className="min-h-screen bg-[#F8FAF7] text-[#111C18] pb-24 md:pb-12">
      {/* Strict 3-Zone Top Navigation Bar Contract */}
      <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-[#E2E8E0] px-5 sm:px-8 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Title (Single text element, one line) */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('home');
          }}
          className="text-lg font-bold tracking-tight text-[#111C18] font-display whitespace-nowrap shrink-0"
        >
          Daily Attendance
        </a>

        {/* Zone 2: 4 Single-Line Navigation Links on Desktop */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-[#52635B]">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`hover:text-[#111C18] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'home'
                ? 'text-[#111C18] font-bold underline underline-offset-8 decoration-emerald-600 decoration-2'
                : ''
            }`}
          >
            Home Sanctuary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`hover:text-[#111C18] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'calendar'
                ? 'text-[#111C18] font-bold underline underline-offset-8 decoration-emerald-600 decoration-2'
                : ''
            }`}
          >
            Calendar &amp; Badges
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('todo')}
            className={`hover:text-[#111C18] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'todo'
                ? 'text-[#111C18] font-bold underline underline-offset-8 decoration-emerald-600 decoration-2'
                : ''
            }`}
          >
            Smart To-Do
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('locker')}
            className={`hover:text-[#111C18] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'locker'
                ? 'text-[#111C18] font-bold underline underline-offset-8 decoration-emerald-600 decoration-2'
                : ''
            }`}
          >
            Drive Locker
          </button>
        </nav>

        {/* Zone 3: 1 Primary Contextual Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-[#111C18] bg-[#F8FAF7] border border-[#E2E8E0] rounded-xl hover:bg-slate-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Settings className="w-4 h-4 text-[#52635B]" />
            <span>Profile &amp; Settings</span>
          </button>
        </div>
      </header>

      {/* Non-Intrusive Offline Mode Indicator */}
      {!isOnline && (
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-4">
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs font-medium text-amber-900 flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Offline Mode — Local task alarms are active. Connect to the internet to verify network time for daily attendance.
            </span>
          </div>
        </div>
      )}

      {/* Main Content Container (Full Multi-Column Desktop Presence) */}
      <main className="max-w-6xl mx-auto px-5 sm:px-8 pt-6 sm:pt-10">
        {attendanceBanner && (
          <div className="mb-6 rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-emerald-950">
              <Sparkles className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{attendanceBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setAttendanceBanner(null)}
              className="text-xs font-bold text-emerald-800 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: HOME SANCTUARY */}
        {activeTab === 'home' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
            {/* Left 7 Columns: Virtual Plant Sanctuary & Daily Attendance CTA */}
            <div className="lg:col-span-7 rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8 flex flex-col justify-between">
              <div>
                {/* Student Greeting & Unboxed Metadata */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-[#52635B]">
                      <span>{profile.studentClass}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        Network Date: {networkDate}
                      </span>
                    </div>
                    <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#111C18]">
                      Hello, {profile.displayName}
                    </h1>
                  </div>

                  {/* Streak Counter & Total Present Button (Same Line, Equal Size) */}
                  <div className="grid grid-cols-2 gap-3.5 w-full sm:w-auto items-stretch">
                    <div className="w-full sm:min-w-[160px] min-h-[56px] rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] px-4 py-3 flex flex-col items-center justify-center text-center">
                      <div className="flex items-center justify-center gap-2 text-amber-600 whitespace-nowrap">
                        <Flame className="w-4 h-4 fill-amber-500 shrink-0" />
                        <span className="text-xl font-extrabold font-mono-tabular text-[#111C18] leading-none">
                          {profile.currentStreak}
                        </span>
                        <span className="text-xs font-bold text-[#52635B]">
                          day streak
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveTab('calendar')}
                      className="w-full sm:min-w-[190px] min-h-[76px] rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] hover:bg-slate-100 transition-colors px-5 py-3.5 flex flex-col items-center justify-center text-center cursor-pointer"
                    >
                      <div className="flex items-center justify-center gap-2 text-emerald-600 whitespace-nowrap">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span className="text-xl font-extrabold font-mono-tabular text-[#111C18] leading-none">
                          {Math.max(
                            Object.values(attendanceMap).filter(
                              (r) => r.status === 'present'
                            ).length,
                            profile.currentStreak
                          )}
                        </span>
                        <span className="text-xs font-bold text-[#52635B]">
                          present
                        </span>
                      </div>
                      <p className="mt-2 px-2 py-0.5 text-xs font-mono-tabular text-[#52635B] whitespace-nowrap tracking-wide">
                        Total Present
                      </p>
                    </button>
                  </div>
                </div>

                {/* Wilted Warning Callout if student missed 1 school day */}
                {profile.plantHealth === 'wilted' && (
                  <div className="mt-5 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-sm text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Your {profile.currentFlowerType} is thirsty!</span>{' '}
                      You missed 1 school day. Mark today&apos;s selfie attendance now to revive your plant before it resets to a seed!
                    </div>
                  </div>
                )}

                {/* Living Potted Plant Illustration */}
                <div className="my-6">
                  <PlantIllustration
                    cycleDay={profile.plantCycleDay}
                    flowerType={profile.currentFlowerType}
                    health={profile.plantHealth}
                    isWatering={isWatering}
                    size="lg"
                  />
                </div>

                {/* Plant Growth Stage Progress Bar */}
                <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className="font-bold text-[#111C18]">
                        {profile.currentFlowerType} — {currentStage} Stage
                      </span>
                      <span className="mx-1.5 text-[#52635B]">·</span>
                      <span className="text-[#52635B]">
                        {profile.plantHealth === 'wilted'
                          ? 'Needs Watering Today'
                          : 'Healthy & Growing'}
                      </span>
                    </div>
                    <span className="font-mono-tabular font-bold text-emerald-700">
                      Day {profile.plantCycleDay} of 30
                    </span>
                  </div>

                  <div className="mt-3 w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        profile.plantHealth === 'wilted'
                          ? 'bg-amber-500'
                          : 'bg-[#16A34A]'
                      }`}
                      style={{
                        width: `${Math.max(
                          4,
                          Math.min(100, Math.round((profile.plantCycleDay / 30) * 100))
                        )}%`,
                      }}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[#52635B]">
                    <span>Seed (0)</span>
                    <span>Sprout (1–6)</span>
                    <span>Sapling (7–14)</span>
                    <span>Bud (15–23)</span>
                    <span>Bloom (24–30)</span>
                  </div>
                </div>
              </div>

              {/* Primary Thumb-Zone CTA: Mark Attendance with Live Selfie */}
              <div className="mt-6">
                {alreadyMarkedToday ? (
                  <button
                    type="button"
                    onClick={() => setIsSelfieModalOpen(true)}
                    className="w-full min-h-[52px] px-5 rounded-2xl bg-slate-100 border border-[#E2E8E0] text-[#111C18] font-semibold text-sm flex items-center justify-center gap-2.5 hover:bg-slate-200/70 transition-colors"
                  >
                    <Lock className="w-4 h-4 text-emerald-700 shrink-0 ml-1" />
                    <span>
                      Today&apos;s Attendance Marked ({networkDate}) · Camera Locked
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsSelfieModalOpen(true)}
                    className="w-full min-h-[52px] px-5 rounded-2xl bg-[#16A34A] hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-5 h-5 shrink-0 ml-2"
                    >
                      <path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" />
                      <circle
                        cx="13"
                        cy="13"
                        r="3"
                        style={{
                          paddingLeft: '0px',
                          marginLeft: '0px',
                          marginRight: '0px',
                        }}
                      />
                    </svg>
                    <span>Mark Today&apos;s Attendance (Live Selfie)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Right 5 Columns: Today's Smart Tasks & Exam Countdown */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-6">
              {/* Today's Smart Tasks Card */}
              <div className="rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E2E8E0]">
                    <div>
                      <h2 className="text-base font-bold text-[#111C18]">
                        Upcoming Tasks &amp; Alarms
                      </h2>
                      <p className="text-xs text-[#52635B]">
                        Homework, submissions &amp; board exam reminders
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('todo')}
                      className="min-h-[40px] px-3 rounded-xl bg-[#F8FAF7] border border-[#E2E8E0] text-xs font-semibold text-[#111C18] hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                    >
                      View All ({tasks.filter((t) => !t.completed).length})
                    </button>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {todaysTasks.length === 0 ? (
                      <div className="py-8 text-center">
                        <AlarmClock className="w-7 h-7 text-[#52635B] mx-auto mb-2 opacity-60" />
                        <p className="text-xs font-semibold text-[#111C18]">
                          No pending tasks scheduled
                        </p>
                        <p className="text-xs text-[#52635B] mt-0.5">
                          Add homework or exam dates so your local alarm rings on time.
                        </p>
                      </div>
                    ) : (
                      todaysTasks.map((task) => (
                        <div
                          key={task.taskId}
                          className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-3 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <button
                              type="button"
                              onClick={() => handleToggleTaskDone(task)}
                              className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-300 bg-white flex items-center justify-center text-transparent hover:border-emerald-600 transition-colors shrink-0"
                              aria-label={`Complete ${task.title}`}
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#111C18] truncate">
                                {task.title}
                              </p>
                              <p className="text-xs font-mono-tabular text-[#52635B]">
                                {task.dueDate} · {task.dueTime}
                              </p>
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-emerald-800 shrink-0">
                            {task.category === 'board_exam' ? 'Exam' : 'Alarm'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('todo')}
                  className="mt-4 w-full min-h-[44px] rounded-xl border border-[#E2E8E0] hover:bg-slate-50 text-xs font-semibold text-[#111C18] flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Task or Exam Countdown</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: READ-ONLY HISTORY CALENDAR & BADGES */}
        {activeTab === 'calendar' && (
          <HistoryCalendarView
            profile={profile}
            attendanceMap={attendanceMap}
            holidaysMap={holidaysMap}
            networkDate={networkDate}
            onAddHoliday={handleAddHoliday}
            onDeleteHoliday={handleDeleteHoliday}
          />
        )}

        {/* TAB 3: ZERO-CLICK SMART TO-DO LIST */}
        {activeTab === 'todo' && (
          <SmartTodoView
            profile={profile}
            tasks={tasks}
            networkDate={networkDate}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onToggleTaskDone={handleToggleTaskDone}
            onDeleteTask={handleDeleteTask}
          />
        )}

        {/* TAB 4: FREE CLOUD DOCUMENT LOCKER */}
        {activeTab === 'locker' && (
          <DocumentLockerView
            accessToken={accessToken}
            onReconnectDrive={handleReconnectDrive}
            isConnecting={driveConnecting}
          />
        )}
      </main>

      {/* Fixed Bottom Tab Bar on Mobile (Ergonomic Thumb Zone, <= 15% Sticky Cap) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-[#E2E8E0] grid grid-cols-4 items-center"
      >
        <button
          type="button"
          onClick={() => setActiveTab('home')}
          className={`min-h-[48px] flex flex-col items-center justify-center ${
            activeTab === 'home' ? 'text-[#16A34A]' : 'text-[#52635B]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-xs font-semibold mt-0.5">Home</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('calendar')}
          className={`min-h-[48px] flex flex-col items-center justify-center ${
            activeTab === 'calendar' ? 'text-[#16A34A]' : 'text-[#52635B]'
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-xs font-semibold mt-0.5">Calendar</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('todo')}
          className={`min-h-[48px] flex flex-col items-center justify-center ${
            activeTab === 'todo' ? 'text-[#16A34A]' : 'text-[#52635B]'
          }`}
        >
          <AlarmClock className="w-5 h-5" />
          <span className="text-xs font-semibold mt-0.5">To-Do</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('locker')}
          className={`min-h-[48px] flex flex-col items-center justify-center ${
            activeTab === 'locker' ? 'text-[#16A34A]' : 'text-[#52635B]'
          }`}
        >
          <FolderLock className="w-5 h-5" />
          <span className="text-xs font-semibold mt-0.5">Locker</span>
        </button>
      </nav>

      {/* First-Launch Onboarding Wizard */}
      {!profile.onboardingCompleted && (
        <OnboardingWizardModal
          profile={profile}
          onCompleteOnboarding={handleSaveProfileSettings}
        />
      )}

      {/* Live Selfie Attendance Modal */}
      <SelfieAttendanceModal
        isOpen={isSelfieModalOpen}
        alreadyMarkedToday={alreadyMarkedToday}
        holidaysMap={holidaysMap}
        onClose={() => setIsSelfieModalOpen(false)}
        onAttendanceVerified={handleAttendanceVerified}
      />

      {/* Profile & Privacy Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        profile={profile}
        userEmail={currentUser.email}
        onClose={() => setIsSettingsOpen(false)}
        onSaveProfile={handleSaveProfileSettings}
        onSignOut={logout}
        onDeleteMyData={handleDeleteAllData}
      />

      {/* Active Ringing Task Alarm Overlay with Snooze & Mark-Done */}
      {ringingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8E0] p-6 text-center shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3">
              <BellRing className="w-7 h-7 animate-bounce" />
            </div>
            <p className="text-xs font-bold text-amber-800">
              Scheduled Task Alarm · {ringingTask.dueTime}
            </p>
            <h3 className="mt-1 text-lg font-extrabold text-[#111C18]">
              {ringingTask.title}
            </h3>
            {ringingTask.notes && (
              <p className="mt-1.5 text-xs text-[#52635B]">{ringingTask.notes}</p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleSnoozeRingingTask(5)}
                className="min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] text-xs font-semibold text-[#111C18] hover:bg-slate-100"
              >
                Snooze 5m
              </button>
              <button
                type="button"
                onClick={() => handleSnoozeRingingTask(10)}
                className="min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] text-xs font-semibold text-[#111C18] hover:bg-slate-100"
              >
                Snooze 10m
              </button>
            </div>

            <button
              type="button"
              onClick={handleMarkDoneFromAlarm}
              className="mt-2.5 w-full min-h-[48px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark Task Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
