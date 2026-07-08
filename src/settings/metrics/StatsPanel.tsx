import React from 'react';
import { Clock, Zap, Flame, TrendingUp } from 'lucide-react';
import { UserMetricsData } from './metricsTypes';

interface StatsPanelProps {
  metrics: UserMetricsData;
  timeTodayStr: string;
  weeklyTimeStr: string;
  editsToday: number;
  activeDays: number;
  bestStreak: number;
}

export function StatsPanel({
  metrics,
  timeTodayStr,
  weeklyTimeStr,
  editsToday,
  activeDays,
}: StatsPanelProps) {
  return (
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
          Active days: <span className="font-bold text-amber-500">{activeDays}</span>
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
  );
}
