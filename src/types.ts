export type StudentClassOption =
  | 'Class 9'
  | 'Class 10'
  | 'Class 11'
  | 'Class 12'
  | 'College';

export type FlowerSpecies = 'Sunflower' | 'Rose' | 'Lotus' | 'Orchid';

export type PlantStage = 'Seed' | 'Sprout' | 'Sapling' | 'Bud' | 'Full Bloom';

export type PlantHealthState = 'healthy' | 'wilted';

export type TaskCategory = 'homework' | 'submission' | 'board_exam';

export interface UserProfile {
  uid: string;
  displayName: string;
  studentClass: StudentClassOption;
  boardExamDate: string; // YYYY-MM-DD
  parentConsentConfirmed: boolean;
  currentStreak: number;
  bestStreak: number;
  lastAttendanceDate: string; // YYYY-MM-DD or ''
  plantCycleDay: number; // 0 to 30
  currentFlowerType: FlowerSpecies;
  plantHealth: PlantHealthState;
  consecutiveMissedDays: number;
  earnedBadges: string[]; // e.g., ["Sunflower::2026-10-10"]
  onboardingCompleted: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceRecord {
  dateId: string; // YYYY-MM-DD
  userId: string;
  status: 'present';
  verifiedFace: boolean;
  networkTimestamp: string;
  selfieDisposition: 'verified_and_discarded';
  streakAtMark: number;
  plantStageAtMark: PlantStage;
  createdAt?: unknown;
}

export interface TaskItem {
  taskId: string;
  userId: string;
  title: string;
  notes: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  category: TaskCategory;
  completed: boolean;
  alarmEnabled: boolean;
  snoozedUntil: string; // ISO string or ''
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HolidayItem {
  dateId: string; // YYYY-MM-DD
  userId: string;
  label: string;
  createdAt?: unknown;
}

export interface DriveDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number; // bytes
  createdTime: string;
  webContentLink?: string;
}

export interface NetworkTimePayload {
  trusted: boolean;
  isoTimestamp: string;
  epochMs: number;
  networkDate: string; // YYYY-MM-DD
  dayOfWeek: number; // 0 = Sunday
  isSunday: boolean;
  isHoliday?: boolean;
  holidayLabel?: string | null;
  canMarkAttendance?: boolean;
  timezone: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}
