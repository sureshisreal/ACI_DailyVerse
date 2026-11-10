// The go-live time for a verse: the date picked in the generator (the output/YYYY/MM/DD folder it was
// saved under) at SOCIAL_POST_TIME (HH:MM, server local time, default 00:00 - midnight, the start of
// the verse's day). Every channel - YouTube publishAt, the Instagram scheduler, Facebook's
// scheduled_publish_time, the WhatsApp queue - is scheduled from this, so a verse goes out
// everywhere at the same moment on its own day.

// Facebook refuses schedules under 10 minutes out; the same margin is used for every channel so they
// all agree on whether a date is still upcoming.
export const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;
// A verse generated for TODAY after its midnight has passed goes out this soon instead (rounded up
// to the next 5 minutes) - it is still its day, so it shouldn't be left unpublished.
const SAME_DAY_LEAD_MS = 15 * 60 * 1000;

export function postTimeForDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(process.env.SOCIAL_POST_TIME || '00:00') || ['', '0', '00'];
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
}

function isToday(date: string): boolean {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return date === `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// When the verse should go live: its date's post time if still far enough ahead; for today's verse
// whose post time has passed, the soonest schedulable moment; null for an earlier date (it has
// passed - everything stays unpublished instead).
export function upcomingPostTime(date: string): Date | null {
  const at = postTimeForDate(date);
  if (!at) return null;
  if (at.getTime() >= Date.now() + MIN_SCHEDULE_LEAD_MS) return at;
  if (!isToday(date)) return null;
  const step = 5 * 60 * 1000;
  return new Date(Math.ceil((Date.now() + SAME_DAY_LEAD_MS) / step) * step);
}
