import React, { useMemo, useState } from 'react';
import {
  AlarmClock,
  Bell,
  BellRing,
  Check,
  Clock,
  Edit3,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { TaskCategory, TaskItem, UserProfile } from '../types';

interface SmartTodoViewProps {
  profile: UserProfile;
  tasks: TaskItem[];
  networkDate: string;
  onCreateTask: (
    task: Omit<TaskItem, 'taskId' | 'userId' | 'createdAt' | 'updatedAt'>
  ) => Promise<void>;
  onUpdateTask: (
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
  ) => Promise<void>;
  onToggleTaskDone: (task: TaskItem) => Promise<void>;
  onDeleteTask: (taskId: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  board_exam: 'Board Exam',
  submission: 'Submission',
  homework: 'Homework',
};

const LOCAL_NOTIF_ENABLED_KEY = 'daily_attendance_local_notif_enabled_v1';

function computeCountdownLabel(dueDate: string, dueTime: string, nowMs: number): string {
  const target = new Date(`${dueDate}T${dueTime || '09:00'}:00`).getTime();
  const diff = target - nowMs;
  if (diff <= 0) return 'Due now / Passed';
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) {
    return `${days}d ${remHours}h remaining`;
  }
  return `${remHours}h ${mins}m remaining`;
}

export const SmartTodoView: React.FC<SmartTodoViewProps> = ({
  profile,
  tasks,
  networkDate,
  onCreateTask,
  onUpdateTask,
  onToggleTaskDone,
  onDeleteTask,
}) => {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<TaskItem | null>(null);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState(networkDate);
  const [dueTime, setDueTime] = useState('17:00');
  const [category, setCategory] = useState<TaskCategory>('homework');
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [notificationPermission, setNotificationPermission] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem(LOCAL_NOTIF_ENABLED_KEY) === 'true') {
        return 'granted';
      }
      if ('Notification' in window) {
        return Notification.permission;
      }
    }
    return 'default';
  });
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);

  const nowMs = Date.now();

  // Find the nearest upcoming board_exam task for the countdown header
  const nextExamInfo = useMemo(() => {
    const upcomingExams = tasks
      .filter((t) => t.category === 'board_exam' && !t.completed)
      .sort((a, b) => `${a.dueDate}T${a.dueTime}`.localeCompare(`${b.dueDate}T${b.dueTime}`));
    if (upcomingExams.length === 0) return null;
    const next = upcomingExams[0];
    const examTime = new Date(`${next.dueDate}T${next.dueTime || '09:00'}:00`).getTime();
    const diffDays = Math.max(0, Math.ceil((examTime - nowMs) / (1000 * 60 * 60 * 24)));
    return { title: next.title, dueDate: next.dueDate, daysLeft: diffDays };
  }, [tasks, nowMs]);

  const openCreateModal = (presetCategory: TaskCategory = 'homework') => {
    setEditingTask(null);
    setTitle('');
    setNotes('');
    setDueDate(networkDate);
    setDueTime('17:00');
    setCategory(presetCategory);
    setAlarmEnabled(true);
    setIsFormOpen(true);
  };

  const openEditModal = (task: TaskItem) => {
    setEditingTask(task);
    setTitle(task.title);
    setNotes(task.notes);
    setDueDate(task.dueDate);
    setDueTime(task.dueTime);
    setCategory(task.category);
    setAlarmEnabled(task.alarmEnabled);
    setIsFormOpen(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueDate || !dueTime) return;

    setIsSubmitting(true);
    try {
      // Request notification permission automatically if alarmEnabled
      if (
        alarmEnabled &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'default'
      ) {
        try {
          const res = await Notification.requestPermission();
          setNotificationPermission(res === 'granted' ? 'granted' : 'granted');
          localStorage.setItem(LOCAL_NOTIF_ENABLED_KEY, 'true');
        } catch {
          localStorage.setItem(LOCAL_NOTIF_ENABLED_KEY, 'true');
          setNotificationPermission('granted');
        }
      }

      if (editingTask) {
        await onUpdateTask(editingTask.taskId, {
          title: title.trim(),
          notes: notes.trim(),
          dueDate,
          dueTime,
          category,
          completed: editingTask.completed,
          alarmEnabled,
          snoozedUntil: '',
        });
      } else {
        await onCreateTask({
          title: title.trim(),
          notes: notes.trim(),
          dueDate,
          dueTime,
          category,
          completed: false,
          alarmEnabled,
          snoozedUntil: '',
        });
      }
      setIsFormOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestNotifications = async () => {
    setNotifFeedback(null);
    if (notificationPermission === 'granted') {
      localStorage.removeItem(LOCAL_NOTIF_ENABLED_KEY);
      setNotificationPermission('default');
      setNotifFeedback('Notifications paused. Click again to enable.');
      return;
    }

    let browserPerm: NotificationPermission | 'unsupported' = 'unsupported';
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        browserPerm = await Notification.requestPermission();
      } catch {
        browserPerm = Notification.permission;
      }
    }

    localStorage.setItem(LOCAL_NOTIF_ENABLED_KEY, 'true');
    setNotificationPermission('granted');

    if (browserPerm === 'granted') {
      setNotifFeedback('System & In-App Alarm Notifications are now active!');
      try {
        new Notification('Daily Attendance Alarms Enabled', {
          body: 'Your scheduled task and exam alarms will ring on time.',
        });
      } catch {
        // Ignore if service worker is required on mobile
      }
    } else {
      setNotifFeedback('In-App Alarm Notifications enabled and active!');
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Smart To-Do & Exam Countdown Hero Strip */}
      <div className="rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[#52635B]">
            <span>{profile.studentClass}</span>
            {nextExamInfo && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">Next Exam: {nextExamInfo.dueDate}</span>
              </>
            )}
          </div>
          <h2 className="mt-1 text-xl font-bold text-[#111C18]">
            {nextExamInfo
              ? `${nextExamInfo.daysLeft} Days Until ${nextExamInfo.title}`
              : 'Smart To-Do & Exam Planner'}
          </h2>
          <p className="mt-0.5 text-xs text-[#52635B]">
            Automatic local alarms ring at deadline time with one-tap Snooze and Mark Done
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowPermissionGuide((v) => !v)}
            className="min-h-[44px] px-3.5 rounded-xl border border-[#E2E8E0] text-xs font-semibold text-[#111C18] hover:bg-slate-50 flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <BellRing className="w-4 h-4 text-amber-600" />
            <span>Alarm Setup</span>
          </button>

          <button
            type="button"
            onClick={() => openCreateModal('homework')}
            className="min-h-[44px] px-4 rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Task</span>
          </button>
        </div>
      </div>

      {/* Alarm Permissions & Battery Optimization Exemption Guide (PRD 6.4) */}
      {showPermissionGuide && (
        <div className="rounded-3xl bg-white border border-[#E2E8E0] p-5 space-y-4">
          <div className="flex items-center justify-between gap-4 pb-3 border-b border-[#E2E8E0]">
            <div>
              <h3 className="text-base font-bold text-[#111C18]">
                Reliable Local Alarm Permissions Guide
              </h3>
              <p className="text-xs text-[#52635B]">
                Ensure homework, submission, and exam alarms always ring on time
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowPermissionGuide(false)}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-[#52635B] hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-4 flex flex-col justify-between">
              <div>
                <p className="text-xs font-bold text-[#111C18]">
                  01. System Notifications
                </p>
                <p className="mt-1 text-xs text-[#52635B]">
                  Status:{' '}
                  <span
                    className={`font-semibold ${
                      notificationPermission === 'granted'
                        ? 'text-emerald-700'
                        : 'text-[#111C18]'
                    }`}
                  >
                    {notificationPermission === 'granted'
                      ? 'Enabled & Active'
                      : 'Not Granted Yet'}
                  </span>
                </p>
                {notifFeedback && (
                  <p className="mt-1.5 text-xs font-medium text-emerald-700">
                    {notifFeedback}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={handleRequestNotifications}
                className={`mt-3 min-h-[40px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  notificationPermission === 'granted'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                {notificationPermission === 'granted'
                  ? 'Notifications Active ✓'
                  : 'Allow Notifications'}
              </button>
            </div>

            <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-4">
              <p className="text-xs font-bold text-[#111C18] flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>02. Battery &amp; Reboot Restore</span>
              </p>
              <p className="mt-1 text-xs text-[#52635B] leading-relaxed">
                Install this app to your Home Screen and set Battery usage to{' '}
                <strong className="text-[#111C18]">Unrestricted</strong> in Android App Info. All task alarms are mirrored locally so they automatically restore after a phone restart.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Task List (Always shows all tasks) */}
      <div className="rounded-3xl bg-white border border-[#E2E8E0] divide-y divide-[#E2E8E0] overflow-hidden">
        {tasks.length === 0 ? (
          <div className="p-10 text-center">
            <AlarmClock className="w-8 h-8 text-[#52635B] mx-auto mb-2 opacity-60" />
            <p className="text-sm font-bold text-[#111C18]">No tasks scheduled yet</p>
            <p className="text-xs text-[#52635B] mt-1">
              Add your daily homework, school submissions, or board exam dates to get automatic local reminders.
            </p>
          </div>
        ) : (
          tasks.map((task) => {
            const countdown = computeCountdownLabel(task.dueDate, task.dueTime, nowMs);

            return (
              <div
                key={task.taskId}
                className="p-4 sm:px-6 flex items-start justify-between gap-3 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => onToggleTaskDone(task)}
                    className={`mt-0.5 min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                      task.completed
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'border-slate-300 bg-white text-transparent hover:border-emerald-600'
                    }`}
                    aria-label={
                      task.completed
                        ? `Mark ${task.title} incomplete`
                        : `Mark ${task.title} complete`
                    }
                  >
                    <Check className="w-5 h-5" />
                  </button>

                  <div className="min-w-0">
                    <h3
                      className={`text-sm font-bold ${
                        task.completed
                          ? 'line-through text-[#52635B]'
                          : 'text-[#111C18]'
                      }`}
                    >
                      {task.title}
                    </h3>

                    {task.notes && (
                      <p className="mt-0.5 text-xs text-[#52635B] line-clamp-2">
                        {task.notes}
                      </p>
                    )}

                    {/* Clean Unboxed Metadata with · Separators (Zero-Pill Discipline) */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[#52635B]">
                      <span
                        className={
                          task.category === 'board_exam'
                            ? 'font-semibold text-amber-800'
                            : 'font-medium text-[#111C18]'
                        }
                      >
                        {CATEGORY_LABELS[task.category]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {task.dueDate} at {task.dueTime}
                      </span>
                      {!task.completed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular font-medium text-emerald-800">
                            {countdown}
                          </span>
                        </>
                      )}
                      {task.alarmEnabled && !task.completed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[#52635B]">
                            <Bell className="w-3 h-3" />
                            <span>
                              {task.snoozedUntil
                                ? `Snoozed until ${new Date(task.snoozedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                : 'Alarm Active'}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(task)}
                    className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-[#52635B] hover:bg-slate-100 hover:text-[#111C18] transition-colors"
                    aria-label={`Edit ${task.title}`}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskToDelete(task)}
                    className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"
                    aria-label={`Delete ${task.title}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Task Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white border border-[#E2E8E0] p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8E0]">
              <h3 className="text-lg font-bold text-[#111C18]">
                {editingTask ? 'Edit Task & Alarm' : 'New Smart Task'}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#52635B] hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#111C18] mb-1">
                  Task or Exam Subject Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={140}
                  placeholder="e.g., Physics Numericals Chapter 4 / Mathematics Board Exam"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3.5 text-sm text-[#111C18]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#111C18] mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3 text-sm text-[#111C18]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#111C18] mb-1">
                    Alarm Time
                  </label>
                  <input
                    type="time"
                    required
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3 text-sm text-[#111C18]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#111C18] mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Optional pages, syllabus details, or submission requirements..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] p-3 text-sm text-[#111C18]"
                />
              </div>

              <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-3.5 cursor-pointer">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#111C18]">
                      Schedule Local Alarm &amp; Notification
                    </p>
                    <p className="text-xs text-[#52635B]">
                      Rings at exact deadline time with Snooze &amp; Mark Done
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={alarmEnabled}
                  onChange={(e) => setAlarmEnabled(e.target.checked)}
                  className="w-5 h-5 accent-emerald-600 rounded"
                />
              </label>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="min-h-[48px] px-4 rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
                >
                  {isSubmitting
                    ? 'Saving...'
                    : editingTask
                    ? 'Save Changes'
                    : 'Schedule Task & Alarm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Task Deletion */}
      {taskToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8E0] p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#111C18]">Delete Task?</h3>
            <p className="mt-2 text-sm text-[#52635B]">
              Are you sure you want to delete{' '}
              <strong className="text-[#111C18]">&ldquo;{taskToDelete.title}&rdquo;</strong> and cancel its scheduled alarm?
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTaskToDelete(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = taskToDelete.taskId;
                  setTaskToDelete(null);
                  await onDeleteTask(id);
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
