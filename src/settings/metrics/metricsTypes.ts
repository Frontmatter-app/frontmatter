export interface UserMetricsData {
  heatmap: { [dateStr: string]: number };
  writingTime: { [dateStr: string]: number };
  focusSessions: {
    totalCount: number;
    avgDurationMin: number;
  };
  focusSessionsDaily?: {
    [dateStr: string]: {
      totalCount: number;
      avgDurationMin: number;
    };
  };
  typingSpeed: {
    avgWpm: number;
    peakWpm: number;
    sampleCount: number;
  };
  hourlyBuckets: { [dateStr: string]: number[] };
  lastSync?: number;
}

export function getEmptyMetrics(): UserMetricsData {
  return {
    heatmap: {},
    writingTime: {},
    focusSessions: { totalCount: 0, avgDurationMin: 0 },
    focusSessionsDaily: {},
    typingSpeed: { avgWpm: 0, peakWpm: 0, sampleCount: 0 },
    hourlyBuckets: {},
  };
}
