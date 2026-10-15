/**
 * Security Rules Verification Suite — The "Dirty Dozen" Payloads
 * Verifies that all 15 adversarial payloads defined in security_spec.md
 * are strictly rejected with PERMISSION_DENIED by firestore.rules.
 */

export interface DirtyDozenScenario {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Cross-User Profile Read (PII Blanket Attack)',
    operation: 'get',
    path: '/users/victim_uid',
    auth: { uid: 'attacker_uid', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Spoof Attack',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: false },
    payload: { uid: 'user_1', displayName: 'Spoofer' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on UserProfile',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: { uid: 'user_1', displayName: 'Student', isAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity Spoofing on Profile Creation',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: { uid: 'user_2', displayName: 'Student' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Forged Client Timestamp Manipulation',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: { uid: 'user_1', createdAt: '2020-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified Face Attendance Record',
    operation: 'create',
    path: '/users/user_1/attendance/2026-10-10',
    auth: { uid: 'user_1', email_verified: true },
    payload: {
      dateId: '2026-10-10',
      userId: 'user_1',
      status: 'present',
      verifiedFace: false,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Tampering with Past Attendance Record (Update Attack)',
    operation: 'update',
    path: '/users/user_1/attendance/2026-10-10',
    auth: { uid: 'user_1', email_verified: true },
    payload: { streakAtMark: 999 },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Deleting Past Attendance Record (History Erasure Attack)',
    operation: 'delete',
    path: '/users/user_1/attendance/2026-10-10',
    auth: { uid: 'user_1', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Orphaned Subcollection Write Without Parent User',
    operation: 'create',
    path: '/users/ghost_uid/tasks/task_1',
    auth: { uid: 'ghost_uid', email_verified: true },
    payload: { taskId: 'task_1', userId: 'ghost_uid', title: 'Orphan Task' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Denial-of-Wallet Oversized String Injection',
    operation: 'create',
    path: '/users/user_1/tasks/task_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: {
      taskId: 'task_1',
      userId: 'user_1',
      title: 'A'.repeat(500),
      notes: 'B'.repeat(10000),
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Path Variable ID Poisoning',
    operation: 'create',
    path: '/users/user_1/tasks/invalid$id!@#',
    auth: { uid: 'user_1', email_verified: true },
    payload: { taskId: 'invalid$id!@#', userId: 'user_1', title: 'Task' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized List Query Scraping',
    operation: 'list',
    path: '/users/victim_uid/tasks',
    auth: { uid: 'attacker_uid', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Client-Side Attendance Forgery (server-only collection)',
    operation: 'create',
    path: '/users/user_1/attendance/2026-10-11',
    auth: { uid: 'user_1', email_verified: true },
    payload: {
      dateId: '2026-10-11',
      userId: 'user_1',
      status: 'present',
      verifiedFace: true,
      selfieDisposition: 'verified_and_discarded',
      streakAtMark: 500,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Client-Side Streak / Plant Tampering',
    operation: 'update',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: { currentStreak: 9999, bestStreak: 9999, plantCycleDay: 29 },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Profile Created With Pre-Inflated Streak',
    operation: 'create',
    path: '/users/user_1',
    auth: { uid: 'user_1', email_verified: true },
    payload: { uid: 'user_1', displayName: 'Student', currentStreak: 9999, earnedBadges: ['Rose::2026-01-01'] },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
