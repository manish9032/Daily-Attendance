import React, { useMemo, useState } from 'react';
import {
  Award,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Lock,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  AttendanceRecord,
  FlowerSpecies,
  HolidayItem,
  UserProfile,
} from '../types';
import { FLOWER_CYCLE_ORDER } from '../lib/networkTime';

interface HistoryCalendarViewProps {
  profile: UserProfile;
  attendanceMap: Record<string, AttendanceRecord>;
  holidaysMap: Record<string, HolidayItem>;
  networkDate: string;
  onAddHoliday: (dateId: string, label: string) => Promise<void>;
  onDeleteHoliday: (dateId: string) => Promise<void>;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BADGE_INFO: Record<
  FlowerSpecies,
  { title: string; subtitle: string; colorClass: string }
> = {
  Sunflower: {
    title: 'Golden Sunflower',
    subtitle: 'Completed a 30-day attendance bloom cycle',
    colorClass: 'bg-amber-50 border-amber-200 text-amber-900',
  },
  Rose: {
    title: 'Crimson Rose',
    subtitle: 'Mastered consistency across 30 school days',
    colorClass: 'bg-rose-50 border-rose-200 text-rose-900',
  },
  Lotus: {
    title: 'Sacred Lotus',
    subtitle: 'Unbroken academic focus for 30 days',
    colorClass: 'bg-pink-50 border-pink-200 text-pink-900',
  },
  Orchid: {
    title: 'Royal Orchid',
    subtitle: 'Elite scholar botanical milestone',
    colorClass: 'bg-purple-50 border-purple-200 text-purple-900',
  },
};

export const HistoryCalendarView: React.FC<HistoryCalendarViewProps> = ({
  profile,
  attendanceMap,
  holidaysMap,
  networkDate,
  onAddHoliday,
  onDeleteHoliday,
}) => {
  const initialDate = useMemo(() => {
    const parts = networkDate.split('-').map(Number);
    return {
      year: parts[0] || new Date().getFullYear(),
      month: (parts[1] || new Date().getMonth() + 1) - 1,
    };
  }, [networkDate]);

  const [viewYear, setViewYear] = useState(initialDate.year);
  const [viewMonth, setViewMonth] = useState(initialDate.month);
  const [selectedDateId, setSelectedDateId] = useState<string>(networkDate);

  // Holiday management form state
  const [holidayDateInput, setHolidayDateInput] = useState('');
  const [holidayLabelInput, setHolidayLabelInput] = useState('');
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);

  // Earliest recorded attendance date (to determine when Absent days start counting)
  const earliestRecordDate = useMemo(() => {
    const dates = Object.keys(attendanceMap).sort();
    return dates.length > 0 ? dates[0] : networkDate;
  }, [attendanceMap, networkDate]);

  const selectMonthAndYear = (newYear: number, newMonth: number) => {
    setViewYear(newYear);
    setViewMonth(newMonth);
    const mm = String(newMonth + 1).padStart(2, '0');
    const prefix = `${newYear}-${mm}`;
    if (networkDate.startsWith(prefix)) {
      setSelectedDateId(networkDate);
    } else {
      setSelectedDateId(`${prefix}-01`);
    }
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      selectMonthAndYear(viewYear - 1, 11);
    } else {
      selectMonthAndYear(viewYear, viewMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      selectMonthAndYear(viewYear + 1, 0);
    } else {
      selectMonthAndYear(viewYear, viewMonth + 1);
    }
  };

  const yearOptions = useMemo(() => {
    const baseYear = initialDate.year;
    return [baseYear - 2, baseYear - 1, baseYear, baseYear + 1, baseYear + 2];
  }, [initialDate.year]);

  // Build calendar cells for current month
  const { firstDayOfWeek, monthCells, stats } = useMemo(() => {
    const firstDay = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    const totalDays = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    let presentCount = 0;
    let absentCount = 0;
    let holidayCount = 0;

    const cells: Array<{
      dayNumber: number;
      dateId: string;
      state: 'present' | 'absent' | 'holiday' | 'upcoming' | 'before_start';
      holidayLabel?: string;
      record?: AttendanceRecord;
    }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const mm = String(viewMonth + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateId = `${viewYear}-${mm}-${dd}`;
      const dow = new Date(Date.UTC(viewYear, viewMonth, d)).getUTCDay();
      const isSunday = dow === 0;
      const customHoliday = holidaysMap[dateId];
      const attRecord = attendanceMap[dateId];

      if (attRecord) {
        presentCount++;
        cells.push({
          dayNumber: d,
          dateId,
          state: 'present',
          record: attRecord,
        });
      } else if (isSunday || customHoliday) {
        holidayCount++;
        cells.push({
          dayNumber: d,
          dateId,
          state: 'holiday',
          holidayLabel: customHoliday ? customHoliday.label : 'Sunday Weekly Off',
        });
      } else if (dateId < networkDate && dateId >= earliestRecordDate) {
        absentCount++;
        cells.push({
          dayNumber: d,
          dateId,
          state: 'absent',
        });
      } else if (dateId < earliestRecordDate) {
        cells.push({
          dayNumber: d,
          dateId,
          state: 'before_start',
        });
      } else {
        cells.push({
          dayNumber: d,
          dateId,
          state: 'upcoming',
        });
      }
    }

    const totalEvaluatedSchoolDays = presentCount + absentCount;
    const percentage =
      totalEvaluatedSchoolDays > 0
        ? Math.round((presentCount / totalEvaluatedSchoolDays) * 100)
        : presentCount > 0
        ? 100
        : 0;

    return {
      daysInMonth: totalDays,
      firstDayOfWeek: firstDay,
      monthCells: cells,
      stats: {
        presentCount,
        absentCount,
        holidayCount,
        percentage,
      },
    };
  }, [viewYear, viewMonth, attendanceMap, holidaysMap, networkDate, earliestRecordDate]);

  const selectedCell = useMemo(
    () => monthCells.find((c) => c.dateId === selectedDateId) || null,
    [monthCells, selectedDateId]
  );

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Top Summary Metrics Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
          <p className="text-xs text-[#52635B]">Monthly Rate</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#111C18]">
            {stats.percentage}%
          </p>
          <p className="mt-0.5 text-xs text-[#52635B]">
            {stats.presentCount} present · {stats.absentCount} absent
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
          <p className="text-xs text-[#52635B]">Current Streak</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#16A34A]">
            {profile.currentStreak}d
          </p>
          <p className="mt-0.5 text-xs text-[#52635B]">
            Cycle day {profile.plantCycleDay}/30
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-[#E2E8E0] p-4">
          <p className="text-xs text-[#52635B]">Best Streak</p>
          <p className="mt-1 text-2xl font-bold font-mono-tabular text-[#D97706]">
            {profile.bestStreak}d
          </p>
          <p className="mt-0.5 text-xs text-[#52635B]">
            {profile.earnedBadges.length} badge(s) earned
          </p>
        </div>
      </div>

      {/* Main 2-Column Split on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Read-Only Attendance Calendar */}
        <div className="lg:col-span-7 rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E2E8E0]">
            <div>
              <h2 className="text-lg font-bold text-[#111C18]">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </h2>
              <p className="text-xs text-[#52635B] flex items-center gap-1.5 mt-0.5">
                <Lock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span>Read-only tamper-resistant attendance ledger</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Select month"
                value={viewMonth}
                onChange={(e) => selectMonthAndYear(viewYear, Number(e.target.value))}
                className="min-h-[40px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3 text-xs font-semibold text-[#111C18]"
              >
                {MONTH_NAMES.map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                aria-label="Select year"
                value={viewYear}
                onChange={(e) => selectMonthAndYear(Number(e.target.value), viewMonth)}
                className="min-h-[40px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-2.5 text-xs font-semibold font-mono-tabular text-[#111C18]"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E2E8E0] flex items-center justify-center text-[#111C18] hover:bg-slate-50 transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E2E8E0] flex items-center justify-center text-[#111C18] hover:bg-slate-50 transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Accessible Color + Shape Legend */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[#52635B]">
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                P
              </span>
              <span>Present (Green Circle)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded bg-red-600 text-white text-xs font-bold flex items-center justify-center">
                A
              </span>
              <span>Absent (Red Square)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-white border-2 border-slate-400 text-slate-700 text-xs font-bold flex items-center justify-center">
                H
              </span>
              <span>Holiday / Sunday (White Ring)</span>
            </span>
          </div>

          {/* Weekday Headers */}
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs font-semibold text-[#52635B]">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Month Days Grid */}
          <div className="mt-1 grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
              <div key={`empty-${idx}`} className="h-12 sm:h-14" />
            ))}

            {monthCells.map((cell) => {
              const isSelected = cell.dateId === selectedDateId;
              const isToday = cell.dateId === networkDate;

              return (
                <button
                  key={cell.dateId}
                  type="button"
                  onClick={() => setSelectedDateId(cell.dateId)}
                  className={`min-h-[48px] sm:h-14 rounded-xl border p-1 flex flex-col items-center justify-between transition-colors ${
                    isSelected
                      ? 'border-[#111C18] bg-slate-50'
                      : isToday
                      ? 'border-emerald-500 bg-emerald-50/40'
                      : 'border-[#E2E8E0] hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`text-xs font-mono-tabular ${
                      isToday ? 'font-bold text-emerald-800' : 'text-[#111C18]'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>

                  {/* Status Indicator with Color + Shape + Letter */}
                  {cell.state === 'present' && (
                    <span
                      className="w-5 h-5 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center"
                      title="Present"
                    >
                      P
                    </span>
                  )}
                  {cell.state === 'absent' && (
                    <span
                      className="w-5 h-5 rounded bg-red-600 text-white text-xs font-bold flex items-center justify-center"
                      title="Absent"
                    >
                      A
                    </span>
                  )}
                  {cell.state === 'holiday' && (
                    <span
                      className="w-5 h-5 rounded-full bg-white border-2 border-slate-400 text-slate-700 text-xs font-bold flex items-center justify-center"
                      title={cell.holidayLabel || 'Holiday'}
                    >
                      H
                    </span>
                  )}
                  {(cell.state === 'upcoming' || cell.state === 'before_start') && (
                    <span className="text-xs text-slate-300">·</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Day Read-Only Inspector */}
          {selectedCell && (
            <div className="mt-4 rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-mono-tabular text-[#52635B]">
                  {selectedCell.dateId}
                </p>
                <p className="text-sm font-bold text-[#111C18] mt-0.5">
                  {selectedCell.state === 'present' &&
                    `Marked Present · Streak Day ${selectedCell.record?.streakAtMark || 1} (${selectedCell.record?.plantStageAtMark || 'Sprout'})`}
                  {selectedCell.state === 'absent' &&
                    'Marked Absent · No selfie recorded on this school day'}
                  {selectedCell.state === 'holiday' &&
                    `School Holiday · ${selectedCell.holidayLabel || 'Weekly Off'}`}
                  {selectedCell.state === 'upcoming' && 'Upcoming Day'}
                  {selectedCell.state === 'before_start' && 'Prior to first attendance record'}
                </p>
                {selectedCell.record && (
                  <p className="text-xs text-[#52635B] mt-0.5">
                    Verified at {new Date(selectedCell.record.networkTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Live selfie verified &amp; discarded
                  </p>
                )}
              </div>
              {selectedCell.state === 'present' && (
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <Check className="w-5 h-5" />
                </div>
              )}
              {selectedCell.state === 'absent' && (
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-800 flex items-center justify-center shrink-0">
                  <X className="w-5 h-5" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 5 Columns: 30-Day Cycle Badges */}
        <div className="lg:col-span-5 space-y-6">
          {/* 30-Day Cycle Badge Collection Vault */}
          <div className="rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E2E8E0]">
              <div>
                <h3 className="text-base font-bold text-[#111C18]">
                  Botanical Badge Collection
                </h3>
                <p className="text-xs text-[#52635B]">
                  Awarded every completed 30-day attendance cycle
                </p>
              </div>
              <Award className="w-5 h-5 text-amber-600 shrink-0" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {FLOWER_CYCLE_ORDER.map((species) => {
                const earnedMatches = profile.earnedBadges.filter((b) =>
                  b.startsWith(species)
                );
                const isEarned = earnedMatches.length > 0;
                const info = BADGE_INFO[species];

                return (
                  <div
                    key={species}
                    className={`rounded-2xl border p-3.5 transition-opacity ${
                      isEarned
                        ? info.colorClass
                        : 'bg-slate-50 border-[#E2E8E0] text-[#52635B] opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold">{info.title}</span>
                      <span className="text-xs font-mono-tabular font-semibold">
                        {isEarned ? `×${earnedMatches.length}` : 'Locked'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug">{info.subtitle}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
