import React, { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { usePlan } from '../../billing/PlanProvider';
import { useSettingsStore } from '../settingsStore';
import { loadLocalMetrics, loadLocalMetricsSync, UserMetricsData } from './metricsSync';
import { 
  Calendar, 
  Clock, 
  Flame, 
  Zap, 
  Sparkles, 
  TrendingUp, 
  ChevronRight, 
  Smile,
  Activity,
  Heart
} from 'lucide-react';

interface RecentActivityDashboardProps {
  metricsOverride?: UserMetricsData;
  displayNameOverride?: string;
}

export function RecentActivityDashboard({ metricsOverride, displayNameOverride }: RecentActivityDashboardProps) {
  const { user } = useAuth();
  const { teamId } = usePlan();
  const { settings } = useSettingsStore();
  const isDark = settings.themeType.startsWith('github_dark');
   
  const uid = user?.uid || 'guest';
  
  const [metrics, setMetrics] = useState<UserMetricsData>(() => 
    metricsOverride || loadLocalMetricsSync(uid)
  );

  useEffect(() => {
    if (metricsOverride) {
      setMetrics(metricsOverride);
      return;
    }
    let active = true;
    loadLocalMetrics(uid).then((data) => {
      if (active) setMetrics(data);
    });
    return () => { active = false; };
  }, [uid, metricsOverride]);
  
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number; x: number; y: number } | null>(null);

  // 1. Calculate Grid Dates (24 Weeks x 7 Days)
  const gridCells = useMemo(() => {
    const cells: { dateStr: string; count: number; dayOfWeek: number; monthLabel: string }[] = [];
    const today = new Date();
    
    // Find the starting Sunday, 24 weeks ago
    const startSunday = new Date(today);
    startSunday.setDate(today.getDate() - (24 * 7) - today.getDay());
    
    for (let i = 0; i < 24 * 7; i++) {
      const cellDate = new Date(startSunday);
      cellDate.setDate(startSunday.getDate() + i);
      const dateStr = cellDate.toISOString().split('T')[0];
      const count = metrics.heatmap[dateStr] || 0;
      
      // Add a month label if this cell represents the 1st of the month
      let monthLabel = '';
      if (cellDate.getDate() === 1 || i === 0) {
        monthLabel = cellDate.toLocaleString('default', { month: 'short' });
      }
      
      cells.push({
        dateStr,
        count,
        dayOfWeek: cellDate.getDay(),
        monthLabel
      });
    }
    return cells;
  }, [metrics.heatmap]);

  // Group cells by column (week) for easier grid rendering
  const columns = useMemo(() => {
    const cols: typeof gridCells[] = [];
    for (let i = 0; i < gridCells.length; i += 7) {
      cols.push(gridCells.slice(i, i + 7));
    }
    return cols;
  }, [gridCells]);

  // 2. Heatmap Color Helper
  const getCellColor = (count: number) => {
    if (count === 0) return isDark ? 'bg-white/5 border border-white/2' : 'bg-black/5 border border-black/2';
    
    if (isDark) {
      if (count < 3) return 'bg-emerald-950 border border-emerald-900 text-emerald-300';
      if (count < 6) return 'bg-emerald-800 border border-emerald-700 text-emerald-200';
      if (count < 10) return 'bg-emerald-600 border border-emerald-500 text-emerald-100';
      return 'bg-emerald-400 border border-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.3)] text-emerald-950';
    } else {
      if (count < 3) return 'bg-emerald-100 border border-emerald-200 text-emerald-800';
      if (count < 6) return 'bg-emerald-300 border border-emerald-400 text-emerald-900';
      if (count < 10) return 'bg-emerald-500 border border-emerald-600 text-emerald-50';
      return 'bg-emerald-600 border border-emerald-700 shadow-[0_2px_4px_rgba(5,150,105,0.2)] text-emerald-50';
    }
  };

  // Compute real insights from metrics data
  const insights = useMemo(() => {
    const dates = Object.keys(metrics.heatmap).sort();
    if (dates.length === 0) {
      return {
        streak: 0,
        bestStreak: 0,
        peakDay: null as string | null,
        recentEdits: 0,
        isActive: false,
        totalEdits: 0,
        activeDays: 0,
        weekendPercent: 0,
      };
    }

    const dayOfWeek = (d: string) => new Date(d + 'T00:00:00').getDay();
    const today = new Date().toISOString().split('T')[0];

    let streak = 0;
    let bestStreak = 0;
    let currentRun = 0;
    let recentEdits = 0;
    let totalEdits = 0;
    let activeDays = 0;
    let weekendEdits = 0;
    let weekdayEdits = 0;

    const dayTotals: { [dow: number]: number } = {};

    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      const count = metrics.heatmap[d] || 0;
      totalEdits += count;

      if (count > 0) {
        activeDays++;
        if (i === dates.length - 1 && d === today) {
          streak++;
          currentRun++;
        } else if (i > 0) {
          const prev = dates[i + 1];
          const prevDate = new Date(prev + 'T00:00:00');
          const currDate = new Date(d + 'T00:00:00');
          const dayDiff = Math.round((prevDate.getTime() - currDate.getTime()) / (1000 * 60 * 60 * 24));
          if (dayDiff === 1) {
            currentRun++;
            if (i === dates.length - 1) streak = currentRun;
          } else {
            currentRun = 1;
            if (i === dates.length - 1) streak = currentRun;
          }
        } else {
          currentRun = 1;
          if (i === dates.length - 1) streak = currentRun;
        }
        bestStreak = Math.max(bestStreak, currentRun);

        const dow = dayOfWeek(d);
        dayTotals[dow] = (dayTotals[dow] || 0) + count;

        if (dow === 0 || dow === 6) {
          weekendEdits += count;
        } else {
          weekdayEdits += count;
        }
      } else {
        currentRun = 0;
      }

      if (i >= dates.length - 7) {
        recentEdits += count;
      }
    }

    const daysWithData = dates.length;
    const weekendPercent = totalEdits > 0 ? Math.round((weekendEdits / totalEdits) * 100) : 0;
    const peakDayNum = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0]?.[0];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDay = peakDayNum !== undefined ? dayNames[Number(peakDayNum)] : null;

    const lastActive = dates.length > 0 ? dates[dates.length - 1] : null;

    return {
      streak,
      bestStreak,
      peakDay,
      recentEdits,
      isActive: totalEdits > 0,
      totalEdits,
      activeDays,
      weekendPercent,
      lastActive,
    };
  }, [metrics.heatmap]);

  // 3. Compute Productivity Indicators
  const todayStr = new Date().toISOString().split('T')[0];
  const editsToday = metrics.heatmap[todayStr] || 0;
  
  // Daily writing time (Today)
  const rawTimeToday = metrics.writingTime[todayStr] || 0;
  const timeTodayStr = rawTimeToday > 0 
    ? `${Math.floor(rawTimeToday / 60)}m ${rawTimeToday % 60}s` 
    : '0m';
    
  // Weekly writing time
  const weeklyWritingTimeSeconds = useMemo(() => {
    const today = new Date();
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      sum += metrics.writingTime[dateStr] || 0;
    }
    return sum;
  }, [metrics.writingTime]);
  
  const weeklyTimeStr = weeklyWritingTimeSeconds > 0
    ? `${Math.floor(weeklyWritingTimeSeconds / 3600)}h ${Math.round((weeklyWritingTimeSeconds % 3600) / 60)}m`
    : '0h';

  // 4. Productive Hours Timeline from real telemetry data
  const hourlyIntensity = useMemo(() => {
    const hours: { hour: number; pct: number }[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, pct: 0 }));

    if (!metrics.hourlyBuckets) return hours;

    const today = new Date();
    const dayTotals = new Array(24).fill(0);

    for (let d = 0; d < 7; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      const buckets = metrics.hourlyBuckets[dateStr];
      if (buckets && buckets.length === 24) {
        for (let h = 0; h < 24; h++) {
          dayTotals[h] += buckets[h];
        }
      }
    }

    const maxTotal = Math.max(...dayTotals, 1);
    for (let h = 0; h < 24; h++) {
      hours[h].pct = Math.round((dayTotals[h] / maxTotal) * 100);
    }

    return hours;
  }, [metrics.hourlyBuckets]);

  return (
    <div className="flex flex-col gap-6 text-[var(--editor-text-color)] select-none">
      
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between pb-3 border-b border-black/10 dark:border-white/10">
        <div>
          <h3 className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            {displayNameOverride ? `${displayNameOverride}'s Writing Activity` : 'Recent Writing Activity'}
          </h3>
          <p className="text-[11px] opacity-60">
            {displayNameOverride ? `Review activity patterns for ${displayNameOverride}` : 'Track your writing consistency and deep work patterns'}
          </p>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full text-[10px] font-bold">
          <Flame className="w-3 h-3 fill-emerald-500/20" />
          Active Streak: {insights.streak} days
        </div>
      </div>

      {/* 1. GITHUB HEATMAP ROW */}
      <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl relative overflow-visible">
        <h4 className="text-xs font-bold mb-3 flex items-center gap-1.5 opacity-80">
          <Calendar className="w-4 h-4 text-blue-500" />
          Consistency Heatmap (Last 24 Weeks)
        </h4>

        {/* Heatmap Grid Container */}
        <div className="relative flex flex-col items-start overflow-x-auto py-2">
          
          {/* Months Row */}
          <div className="flex h-4 text-[9px] text-gray-400 dark:text-gray-500 font-medium pl-6 gap-[11.5px] select-none">
            {columns.map((col, cIdx) => {
              const label = col.find(c => c.monthLabel)?.monthLabel;
              return (
                <div key={cIdx} className="w-[12px] text-center overflow-visible whitespace-nowrap">
                  {label || ''}
                </div>
              );
            })}
          </div>

          {/* Grid Layout (Days sidebar + cells columns) */}
          <div className="flex items-start gap-1">
            {/* Days Column */}
            <div className="flex flex-col text-[9px] text-gray-400 dark:text-gray-500 font-mono w-5 h-[84px] justify-between pt-0.5 pr-1.5">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>

            {/* Heatmap Columns */}
            <div className="flex gap-[3px]">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="flex flex-col gap-[3px]">
                  {col.map((cell, rowIdx) => (
                    <div
                      key={rowIdx}
                      className={`w-[9px] h-[9px] rounded-[1.5px] transition-colors cursor-pointer ${getCellColor(cell.count)}`}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredCell({
                          date: cell.dateStr,
                          count: cell.count,
                          x: rect.left + window.scrollX - 50,
                          y: rect.top + window.scrollY - 38
                        });
                      }}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Heatmap Legend */}
        <div className="flex justify-between items-center mt-3 text-[9px] text-gray-400 dark:text-gray-500 font-medium pt-2 border-t border-black/5 dark:border-white/5">
          <span>{gridCells[0]?.dateStr} to {gridCells[gridCells.length - 1]?.dateStr}</span>
          <div className="flex items-center gap-1">
            <span>Less</span>
            <div className="w-2 h-2 rounded-[1px] bg-black/5 dark:bg-white/5 border border-black/10" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/20" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/50" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-500/80" />
            <div className="w-2 h-2 rounded-[1px] bg-emerald-400" />
            <span>More</span>
          </div>
        </div>

        {/* Tooltip Popup */}
        {hoveredCell && (
          <div 
            className="fixed z-50 px-2.5 py-1.5 bg-black/90 dark:bg-white/95 text-white dark:text-black rounded-lg text-[10px] font-bold shadow-md pointer-events-none transition-all flex flex-col items-center border border-white/10 dark:border-black/10"
            style={{ left: hoveredCell.x, top: hoveredCell.y }}
          >
            <span>{hoveredCell.count} edits</span>
            <span className="opacity-70 font-medium text-[8px]">{hoveredCell.date}</span>
          </div>
        )}
      </div>

      {/* 2. STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        
        {/* Card 1: Writing Time */}
        <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-blue-500">
            <Clock className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Writing Time</span>
          </div>
          <div>
            <div className="text-lg font-bold">{timeTodayStr}</div>
            <div className="text-[9px] opacity-60">Today</div>
          </div>
          <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium opacity-80">
            This Week: <span className="font-bold text-blue-500">{weeklyTimeStr}</span>
          </div>
        </div>

        {/* Card 2: Focus Sessions */}
        <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-purple-500">
            <Zap className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Focus Sessions</span>
          </div>
          <div>
            <div className="text-lg font-bold">{metrics.focusSessions.totalCount} sessions</div>
            <div className="text-[9px] opacity-60">Deep work blocks</div>
          </div>
          <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium opacity-80">
            Average: <span className="font-bold text-purple-500">{metrics.focusSessions.avgDurationMin} mins</span>
          </div>
        </div>

        {/* Card 3: Edits Today */}
        <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-amber-500">
            <Flame className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Edits Today</span>
          </div>
          <div>
            <div className="text-lg font-bold">{editsToday}</div>
            <div className="text-[9px] opacity-60">Keystroke events</div>
          </div>
          <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium opacity-80">
            Active days: <span className="font-bold text-amber-500">{insights.activeDays}</span>
          </div>
        </div>

        {/* Card 4: Typing Speed */}
        <div className="p-3 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-emerald-500">
            <TrendingUp className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">Typing Speed</span>
          </div>
          <div>
            <div className="text-lg font-bold">{metrics.typingSpeed.avgWpm} WPM</div>
            <div className="text-[9px] opacity-60">Average rate</div>
          </div>
          <div className="pt-1.5 border-t border-black/5 dark:border-white/5 text-[9px] font-medium opacity-80">
            Peak Speed: <span className="font-bold text-emerald-500">{metrics.typingSpeed.peakWpm} WPM</span>
          </div>
        </div>

      </div>

      {/* 3. PRODUCTIVE HOURS & PERSONAL INSIGHTS SPLIT */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        
        {/* Left Column: Productive Hours (7 cols) */}
        <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl md:col-span-7">
          <h4 className="text-xs font-bold mb-3.5 flex items-center gap-1.5 opacity-80">
            <Clock className="w-4 h-4 text-indigo-500" />
            Productive Hours Distribution
          </h4>
          
          <div className="flex items-end h-28 gap-1.5 px-2 pb-1 bg-black/5 dark:bg-white/2 rounded-xl border border-black/5 dark:border-white/5">
            {hourlyIntensity.map(({ hour, pct }) => {
              const barColor = pct > 0
                ? 'bg-emerald-500 hover:bg-emerald-400'
                : 'bg-blue-500/20 dark:bg-white/10';
              return (
                <div 
                  key={hour} 
                  className="flex-1 flex flex-col items-center h-full justify-end group cursor-pointer"
                  title={`${hour}:00 - ${pct}%`}
                >
                  <div 
                    className={`w-full rounded-t-sm transition-all duration-300 ${barColor}`} 
                    style={{ height: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          
          {/* Timeline labels */}
          <div className="flex justify-between px-2.5 mt-2 text-[9px] text-gray-400 dark:text-gray-500 font-mono">
            <span>12 AM</span>
            <span>6 AM</span>
            <span>12 PM</span>
            <span>6 PM</span>
            <span>11 PM</span>
          </div>

          <div className="mt-3.5 p-2 bg-emerald-500/5 border border-emerald-500/10 rounded-xl text-[10px] flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span>{insights.isActive 
              ? `Your peak activity tends to land on <b>${insights.peakDay || 'weekdays'}</b>${insights.weekendPercent > 40 ? `, with <b>${insights.weekendPercent}%</b> of your activity happening on weekends.` : '.'}`
              : 'Track some edits to see your peak productivity hours.'}</span>
          </div>
        </div>

        {/* Right Column: Personal Insights (5 cols) */}
        <div className="p-4 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl md:col-span-5 flex flex-col justify-between">
          <div>
            <h4 className="text-xs font-bold mb-3.5 flex items-center gap-1.5 opacity-80">
              <Sparkles className="w-4 h-4 text-purple-500" />
              Writing Insights
            </h4>
            
            <div className="flex flex-col gap-2.5">
              {insights.isActive ? (
                <>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      You've contributed <span className="font-semibold text-purple-500">{insights.totalEdits}</span> edits across <span className="font-semibold text-blue-500">{insights.activeDays}</span> active days over the last 24 weeks.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      Your longest streak is <span className="font-semibold text-emerald-500">{insights.bestStreak} days</span>{insights.streak > 0 ? ` (current: ${insights.streak})` : ''}.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      {insights.peakDay 
                        ? <>You write most consistently on <span className="font-semibold text-amber-500">{insights.peakDay}</span>.</>
                        : <>Keep writing to discover your most productive day.</>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      {insights.weekendPercent > 35
                        ? <><span className="font-semibold text-purple-500">{insights.weekendPercent}%</span> of your activity lands on weekends — you're a weekend writer.</>
                        : <><span className="font-semibold text-blue-500">{100 - insights.weekendPercent}%</span> of your activity lands on weekdays — you prefer structured work hours.</>}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      No activity data yet. Start editing to build your writing history and unlock personalized insights.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <ChevronRight className="w-3.5 h-3.5 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] leading-relaxed">
                      Consistency is key — even <span className="font-semibold text-emerald-500">10 minutes daily</span> builds meaningful momentum over time.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
          
          <div className="mt-4 pt-3.5 border-t border-black/5 dark:border-white/5 flex items-center justify-between text-[9px] opacity-75">
            <span className="flex items-center gap-1">
              <Heart className="w-3 h-3 text-red-500 fill-red-500" /> Technical Writers choice
            </span>
            <span className="font-mono text-[8px] bg-black/5 dark:bg-white/5 px-1.5 py-0.5 rounded">
              Updated just now
            </span>
          </div>
        </div>

      </div>

    </div>
  );
}
