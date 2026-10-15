# Security Specification — Daily Attendance

## 1. Data Invariants

1. **Identity & Ownership Isolation**: Every `/users/{userId}` document and all subcollections (`/attendance/{dateId}`, `/tasks/{taskId}`, `/holidays/{dateId}`) belong strictly to `request.auth.uid == userId` with `request.auth.token.email_verified == true` for writes.
2. **Master Gate Relational Integrity**: Subcollection records (`attendance`, `tasks`, `holidays`) can only be created or accessed if the parent `/users/{userId}` document exists and its `uid` matches `request.auth.uid`.
3. **Immutable Read-Only Attendance History**: Once an `/attendance/{dateId}` document is created with `verifiedFace == true` and `status == 'present'`, it can **never** be updated (`allow update: if false;`) or deleted (`allow delete: if false;`), enforcing the PRD's read-only attendance ledger requirement.
4. **Strict Key & Volumetric Boundaries**: Every write enforces `.keys().hasAll(...)` and `.keys().hasOnly(...)` on `create`, and action-based `affectedKeys().hasOnly(...)` wrapped inside `isValid[Entity](incoming())` on `update`. All strings and arrays have strict `.size()` upper bounds, and all IDs match `^[a-zA-Z0-9_\-]+$`.
5. **Temporal Integrity**: `createdAt` and `updatedAt` must strictly equal `request.time` on creation/update, and `createdAt`, `uid`, and `userId` are immutable across updates.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Cross-User Profile Read/Write (PII Blanket Attack)**:
   - User `attacker_uid` attempts `get` or `update` on `/users/victim_uid`.
2. **Payload 2 — Unverified Email Spoof Attack**:
   - Authenticated user with `email_verified: false` attempts to create `/users/user_1`.
3. **Payload 3 — Shadow Field Injection on UserProfile**:
   - User sends valid `UserProfile` payload plus extra key `{"isAdmin": true}` to `/users/user_1`.
4. **Payload 4 — Identity Spoofing on Profile Creation**:
   - User `user_1` creates `/users/user_1` with payload `{"uid": "user_2"}`.
5. **Payload 5 — Forged Client Timestamp (`createdAt` Manipulation)**:
   - User sends `createdAt: Timestamp.fromMillis(1700000000000)` instead of `request.time`.
6. **Payload 6 — Backdated / Unverified Face Attendance Record**:
   - User attempts to create `/users/user_1/attendance/2026-10-10` with `verifiedFace: false` or `status: "holiday"`.
7. **Payload 7 — Tampering with Past Attendance Record (Update Attack)**:
   - User attempts `update` on `/users/user_1/attendance/2026-10-10` to modify `networkTimestamp` or `streakAtMark`.
8. **Payload 8 — Deleting Past Attendance Record (History Erasure Attack)**:
   - User attempts `delete` on `/users/user_1/attendance/2026-10-10`.
9. **Payload 9 — Orphaned Subcollection Write (Missing Master Gate Parent)**:
   - User `ghost_uid` (who has no `/users/ghost_uid` profile document) attempts to create `/users/ghost_uid/tasks/task_1`.
10. **Payload 10 — Denial-of-Wallet Oversized String / Array Injection**:
    - User attempts to create a task with a 10,000-character `notes` string or a profile with 100 `earnedBadges`.
11. **Payload 11 — Path Variable ID Poisoning**:
    - User attempts to create `/users/user_1/tasks/invalid$id!@#` violating `^[a-zA-Z0-9_\-]+$`.
12. **Payload 12 — Unauthorized List Query Scraping**:
    - User `attacker_uid` attempts `list` on `/users/victim_uid/tasks` where `resource.data.userId != request.auth.uid`.


## Update: Server-Authoritative Attendance (latest)

- `/users/{uid}/attendance/{dateId}`: **client create is denied**. Records are written only by the Express server (Firebase Admin SDK) in `POST /api/attendance/mark`, after verifying the Firebase ID token, the school-day calendar, and a server-side face check.
- `/users/{uid}` **update** from clients is limited to profile settings (`displayName`, `studentClass`, `boardExamDate`, `parentConsentConfirmed`, `onboardingCompleted`). Streak, best streak, plant, wilt and badge fields are server-only (`/api/attendance/mark`, `/api/streak/reconcile`).
- `/users/{uid}` **create** must start clean (streak 0, no badges, seed stage).
- Custom holidays only count if created on or before the holiday date (checked server-side), so past missed days cannot be hidden afterwards.
- Tests 13-15 in `firestore.rules.test.ts` cover these cases.
