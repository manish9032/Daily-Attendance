import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AttendanceRecord,
  FirestoreErrorInfo,
  HolidayItem,
  OperationType,
  TaskItem,
  UserProfile,
} from '../types';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

/**
 * Fresh Firebase ID token for calling the protected server API
 * (/api/attendance/mark, /api/streak/reconcile).
 */
export async function getFirebaseIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  return user.getIdToken();
}

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

// Flag indicating active sign-in popup flow
let isSigningIn = false;
// In-memory cache for the Google Drive OAuth access token (never stored in localStorage)
let cachedAccessToken: string | null = null;

/**
 * Mandatory Firestore Connection Validation on Boot
 */
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

/**
 * Standardized Firestore Error Handler (Mandatory per firebase-integration-rpc skill)
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Initialize Firebase Auth state listener and manage in-memory access token
 */
export const initAuth = (
  onAuthChange: (user: User | null, accessToken: string | null) => void
): Unsubscribe => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (!isSigningIn && !cachedAccessToken) {
        onAuthChange(user, null);
      } else {
        onAuthChange(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      onAuthChange(null, null);
    }
  });
};

/**
 * Sign in with Google and obtain both Firebase User and Google Drive OAuth accessToken
 */
export const googleSignIn = async (
  options: { loginHint?: string | null } = {}
): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    // Reconnecting Drive: pre-select the student's own account instead of
    // showing the account chooser again.
    provider.setCustomParameters(
      options.loginHint
        ? { login_hint: options.loginHint }
        : { prompt: 'select_account' }
    );
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || '';
    cachedAccessToken = token || null;
    return { user: result.user, accessToken: token };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/** Lets other modules store a Drive token obtained outside the Firebase popup. */
export const setCachedAccessToken = (token: string | null): void => {
  cachedAccessToken = token;
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

/**
 * Blueprint Validation Constants & Defensive Sanitization Helpers
 * Enforces exact volumetric limits from firebase-blueprint.json
 */
export const BLUEPRINT_LIMITS = {
  ID_MAX_LEN: 128,
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  DATE_REGEX: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  TIME_REGEX: /^[0-9]{2}:[0-9]{2}$/,
  DISPLAY_NAME_MAX: 80,
  TASK_TITLE_MAX: 140,
  TASK_NOTES_MAX: 500,
  HOLIDAY_LABEL_MAX: 80,
  MAX_BADGES: 50,
};

export function sanitizeString(val: string, maxLen: number, fallback = ''): string {
  const trimmed = (val || '').trim().slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : fallback;
}

export function isValidBlueprintId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= BLUEPRINT_LIMITS.ID_MAX_LEN &&
    BLUEPRINT_LIMITS.ID_REGEX.test(id)
  );
}

/**
 * Firestore Operations for UserProfile
 */
export async function fetchOrCreateUserProfile(
  user: User,
  defaultExamDate: string
): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }

    const initialProfile: UserProfile = {
      uid: user.uid,
      displayName: sanitizeString(
        user.displayName || user.email?.split('@')[0] || 'Student',
        BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
        'Student'
      ),
      studentClass: 'Class 10',
      boardExamDate: defaultExamDate,
      parentConsentConfirmed: false,
      currentStreak: 0,
      bestStreak: 0,
      lastAttendanceDate: '',
      plantCycleDay: 0,
      currentFlowerType: 'Sunflower',
      plantHealth: 'healthy',
      consecutiveMissedDays: 0,
      earnedBadges: [],
      onboardingCompleted: false,
    };

    await setDoc(doc(db, 'users', user.uid), {
      ...initialProfile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return initialProfile;
  } catch (error) {
    return handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateProfileSettings(
  uid: string,
  updates: Pick<
    UserProfile,
    | 'displayName'
    | 'studentClass'
    | 'boardExamDate'
    | 'parentConsentConfirmed'
    | 'onboardingCompleted'
  >
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: sanitizeString(
        updates.displayName,
        BLUEPRINT_LIMITS.DISPLAY_NAME_MAX,
        'Student'
      ),
      studentClass: updates.studentClass,
      boardExamDate: updates.boardExamDate,
      parentConsentConfirmed: Boolean(updates.parentConsentConfirmed),
      onboardingCompleted: Boolean(updates.onboardingCompleted),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Subscribe to user profile changes
 */
export function subscribeToUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        onData(snap.data() as UserProfile);
      } else {
        onData(null);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

/**
 * Subscribe to Immutable Attendance Records
 */
export function subscribeToAttendance(
  uid: string,
  onData: (records: Record<string, AttendanceRecord>) => void
): Unsubscribe {
  const path = `users/${uid}/attendance`;
  const q = query(collection(db, 'users', uid, 'attendance'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, AttendanceRecord> = {};
      snap.forEach((d) => {
        const data = d.data() as AttendanceRecord;
        map[data.dateId] = data;
      });
      onData(map);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

/**
 * Subscribe to Student Tasks
 */
export function subscribeToTasks(
  uid: string,
  onData: (tasks: TaskItem[]) => void
): Unsubscribe {
  const path = `users/${uid}/tasks`;
  const q = query(collection(db, 'users', uid, 'tasks'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: TaskItem[] = [];
      snap.forEach((d) => items.push(d.data() as TaskItem));
      items.sort((a, b) => {
        const aKey = `${a.dueDate}T${a.dueTime}`;
        const bKey = `${b.dueDate}T${b.dueTime}`;
        return aKey.localeCompare(bKey);
      });
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createTaskItem(
  task: Omit<TaskItem, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const path = `users/${task.userId}/tasks/${task.taskId}`;
  try {
    await setDoc(doc(db, 'users', task.userId, 'tasks', task.taskId), {
      taskId: task.taskId,
      userId: task.userId,
      title: sanitizeString(task.title, BLUEPRINT_LIMITS.TASK_TITLE_MAX, 'Untitled Task'),
      notes: (task.notes || '').trim().slice(0, BLUEPRINT_LIMITS.TASK_NOTES_MAX),
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      category: task.category,
      completed: Boolean(task.completed),
      alarmEnabled: Boolean(task.alarmEnabled),
      snoozedUntil: (task.snoozedUntil || '').slice(0, 40),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTaskStatusOrSnooze(
  uid: string,
  taskId: string,
  completed: boolean,
  snoozedUntil: string
): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
      completed: Boolean(completed),
      snoozedUntil: (snoozedUntil || '').slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateTaskDetails(
  uid: string,
  taskId: string,
  updates: Pick<
    TaskItem,
    'title' | 'notes' | 'dueDate' | 'dueTime' | 'category' | 'completed' | 'alarmEnabled' | 'snoozedUntil'
  >
): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
      title: sanitizeString(updates.title, BLUEPRINT_LIMITS.TASK_TITLE_MAX, 'Untitled Task'),
      notes: (updates.notes || '').trim().slice(0, BLUEPRINT_LIMITS.TASK_NOTES_MAX),
      dueDate: updates.dueDate,
      dueTime: updates.dueTime,
      category: updates.category,
      completed: Boolean(updates.completed),
      alarmEnabled: Boolean(updates.alarmEnabled),
      snoozedUntil: (updates.snoozedUntil || '').slice(0, 40),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTaskItem(uid: string, taskId: string): Promise<void> {
  const path = `users/${uid}/tasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'tasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Subscribe to Custom Holidays
 */
export function subscribeToHolidays(
  uid: string,
  onData: (holidays: Record<string, HolidayItem>) => void
): Unsubscribe {
  const path = `users/${uid}/holidays`;
  const q = query(collection(db, 'users', uid, 'holidays'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const map: Record<string, HolidayItem> = {};
      snap.forEach((d) => {
        const item = d.data() as HolidayItem;
        map[item.dateId] = item;
      });
      onData(map);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function createHolidayItem(
  uid: string,
  dateId: string,
  label: string
): Promise<void> {
  const path = `users/${uid}/holidays/${dateId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'holidays', dateId), {
      dateId,
      userId: uid,
      label: sanitizeString(label, BLUEPRINT_LIMITS.HOLIDAY_LABEL_MAX, 'School Holiday'),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteHolidayItem(uid: string, dateId: string): Promise<void> {
  const path = `users/${uid}/holidays/${dateId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'holidays', dateId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Delete My Data (PRD Section 9 Privacy requirement)
 * Deletes all mutable tasks, holidays, and the user profile document.
 */
export async function deleteAllUserData(uid: string): Promise<void> {
  const tasksSnap = await getDocs(
    query(collection(db, 'users', uid, 'tasks'), where('userId', '==', uid))
  );
  for (const docSnap of tasksSnap.docs) {
    await deleteDoc(docSnap.ref);
  }

  const holidaysSnap = await getDocs(
    query(collection(db, 'users', uid, 'holidays'), where('userId', '==', uid))
  );
  for (const docSnap of holidaysSnap.docs) {
    await deleteDoc(docSnap.ref);
  }

  await deleteDoc(doc(db, 'users', uid));
}
