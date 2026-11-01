export type Schedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string; timezone: string };
export interface Automation {
  id: string;
  name: string;
  projectId: string;
  threadId?: string;
  prompt: string;
  providerId?: string;
  model?: string;
  enabled: boolean;
  schedule: Schedule;
  nextAt?: string;
  revision: string;
  error?: string;
}
export interface PullRequestWatch {
  id: string;
  threadId: string;
  repository: string;
  number: number;
  prompt: string;
  enabled: boolean;
  autoContinue: boolean;
  revision: string;
  fingerprint?: string;
  pending?: string;
  summary?: string;
  checkedAt?: string;
  continuedAt?: string;
  lastError?: string;
  deliveries?: number[];
}
export interface BackgroundRun {
  id: string;
  source: 'schedule' | 'pull-request' | 'remote';
  sourceId: string;
  threadId: string;
  name: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  error?: string;
}
export function validateSchedule(value: Schedule): Schedule {
  if (value?.kind === 'once' && Number.isFinite(Date.parse(value.at)))
    return { kind: 'once', at: new Date(value.at).toISOString() };
  if (
    value?.kind === 'interval' &&
    Number.isInteger(value.minutes) &&
    value.minutes >= 5 &&
    value.minutes <= 525600
  )
    return { kind: 'interval', minutes: value.minutes };
  if (
    value?.kind === 'daily' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) &&
    typeof value.timezone === 'string' &&
    value.timezone.length <= 100
  ) {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
    return { kind: 'daily', time: value.time, timezone: value.timezone };
  }
  throw new Error(
    'Choose a date, an interval of at least five minutes, or a daily time and valid timezone.',
  );
}
export function nextOccurrence(
  schedule: Schedule,
  after: number,
  previous?: string,
): string | undefined {
  if (schedule.kind === 'once') return previous ? undefined : schedule.at;
  if (schedule.kind === 'interval') return new Date(after + schedule.minutes * 60000).toISOString();
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (at: number) =>
    Object.fromEntries(format.formatToParts(at).map((p) => [p.type, p.value]));
  const date = (p: Record<string, string>) => `${p.year}-${p.month}-${p.day}`;
  const lastDate = previous ? date(parts(Date.parse(previous))) : undefined;
  // Search UTC minutes: skips nonexistent DST times, and runs at most once per local date.
  for (
    let at = Math.floor(after / 60000) * 60000 + 60000;
    at <= after + 49 * 3600000;
    at += 60000
  ) {
    const p = parts(at);
    if (`${p.hour}:${p.minute}` === schedule.time && date(p) !== lastDate)
      return new Date(at).toISOString();
  }
  throw new Error('Could not calculate the next daily occurrence.');
}
