import fs from 'fs';
import path from 'path';
import { listLibrary, resolveLibraryAsset, buildLibraryCaption, libraryVideoLang } from './library.service';
import { isYoutubeUploadConfigured, getYoutubeVideoStates } from './youtube.service';
import { isInstagramConfigured, publishReelFromFile } from './instagram.service';

// YouTube -> Instagram auto-posting. YouTube stays the place videos are published and scheduled
// (its own publish-at scheduling decides when each goes public); every INSTAGRAM_SYNC_INTERVAL_MIN
// this checks the YouTube uploads recorded in output/ manifests, and each one that has turned PUBLIC
// is posted to Instagram as a Reel from the same local file (see instagram.service.ts).
//
// Safety rails, since this publishes publicly without a click:
// - Only uploads recorded AFTER auto-posting was first enabled count (or after INSTAGRAM_SYNC_SINCE),
//   so switching it on doesn't push the whole existing channel backlog to Instagram at once.
// - At most INSTAGRAM_MAX_PER_RUN posts per pass, one at a time.
// - Each posted file is recorded in its manifest (manifest.instagram[file]) and never posted again;
//   a file that fails INSTAGRAM_MAX_ATTEMPTS times is left alone until someone looks at it.
// - Only portrait Shorts by default; landscape meditation videos with INSTAGRAM_INCLUDE_LONGFORM=true.

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const STATE_FILE = path.join(OUTPUT_DIR, 'instagram-sync.json');
const INTERVAL_MIN = Number(process.env.INSTAGRAM_SYNC_INTERVAL_MIN) || 10;
const MAX_PER_RUN = Number(process.env.INSTAGRAM_MAX_PER_RUN) || 3;
const MAX_ATTEMPTS = Number(process.env.INSTAGRAM_MAX_ATTEMPTS) || 3;

interface SyncState {
  enabledSince?: string;
  lastRunAt?: string;
  lastSummary?: string;
}

interface PostedRecord { mediaId: string; permalink: string | null; postedAt: string; youtubeVideoId: string }
interface FailureRecord { attempts: number; lastError: string; lastAttemptAt: string }

function readState(): SyncState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state: SyncState): void {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err: any) {
    console.warn('[instagram-sync] Could not write state:', err?.message || err);
  }
}

function manifestPathFor(dir: string, file: string): string {
  return path.join(path.dirname(resolveLibraryAsset(dir, file).absPath), 'manifest.json');
}

function readManifestAt(manifestPath: string): any {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return {};
  }
}

function updateManifest(manifestPath: string, mutate: (m: any) => void): void {
  const manifest = readManifestAt(manifestPath);
  mutate(manifest);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

interface Candidate { dir: string; file: string; reference: string; videoId: string; manifestPath: string }

function findCandidates(since: string): Candidate[] {
  const includeLongform = process.env.INSTAGRAM_INCLUDE_LONGFORM === 'true';
  const out: Candidate[] = [];
  for (const entry of listLibrary()) {
    for (const video of entry.videos) {
      if (!video.uploaded?.videoId) continue;
      if (video.kind === 'longform' && !includeLongform) continue;
      if (video.uploaded.uploadedAt < since) continue;
      let manifestPath: string;
      try {
        manifestPath = manifestPathFor(entry.dir, video.file);
      } catch {
        continue;
      }
      const manifest = readManifestAt(manifestPath);
      if (manifest.instagram?.[video.file]) continue;
      // Someone picked a time for this one - the scheduler posts it then, not when YouTube goes public.
      if (manifest.instagramScheduled?.[video.file]) continue;
      if ((manifest.instagramErrors?.[video.file]?.attempts || 0) >= MAX_ATTEMPTS) continue;
      out.push({ dir: entry.dir, file: video.file, reference: entry.reference, videoId: video.uploaded.videoId, manifestPath });
    }
  }
  return out;
}

let running: Promise<SyncRunResult> | null = null;

// Files currently being posted, by either the scheduled sync or a manual post from the library -
// both paths check this (and the manifest) right before posting, so a click during a sync pass
// can't publish the same Reel twice.
const inFlight = new Set<string>();

export interface SyncRunResult {
  ran: boolean;
  summary: string;
  posted: { reference: string; file: string; permalink: string | null }[];
  failed: { reference: string; file: string; error: string }[];
}

async function runOnce(): Promise<SyncRunResult> {
  const result: SyncRunResult = { ran: false, summary: '', posted: [], failed: [] };
  if (!isInstagramConfigured() || !isYoutubeUploadConfigured()) {
    result.summary = !isInstagramConfigured() ? 'Instagram is not configured.' : 'YouTube is not configured.';
    return result;
  }

  const state = readState();
  if (!state.enabledSince) {
    state.enabledSince = new Date().toISOString();
    console.info(`[instagram-sync] Auto-posting enabled; YouTube uploads from ${state.enabledSince} onward will be posted to Instagram once public.`);
  }
  const since = process.env.INSTAGRAM_SYNC_SINCE || state.enabledSince;
  result.ran = true;

  try {
    const candidates = findCandidates(since);
    if (candidates.length) {
      const states = await getYoutubeVideoStates(candidates.map((c) => c.videoId));
      const ready = candidates.filter((c) => states.get(c.videoId)?.privacyStatus === 'public').slice(0, MAX_PER_RUN);
      for (const c of ready) {
        const yt = states.get(c.videoId)!;
        const caption = [yt.title, yt.description].filter(Boolean).join('\n\n');
        const lockKey = `${c.manifestPath}::${c.file}`;
        if (inFlight.has(lockKey) || readManifestAt(c.manifestPath).instagram?.[c.file]) continue;
        inFlight.add(lockKey);
        try {
          const { absPath } = resolveLibraryAsset(c.dir, c.file);
          const published = await publishReelFromFile(absPath, caption);
          const record: PostedRecord = { ...published, postedAt: new Date().toISOString(), youtubeVideoId: c.videoId };
          updateManifest(c.manifestPath, (m) => {
            m.instagram = m.instagram || {};
            m.instagram[c.file] = record;
            if (m.instagramErrors) delete m.instagramErrors[c.file];
          });
          result.posted.push({ reference: c.reference, file: c.file, permalink: published.permalink });
          console.info(`[instagram-sync] Posted ${c.reference} ${c.file} to Instagram: ${published.permalink || published.mediaId}`);
        } catch (err: any) {
          const message = err?.message || String(err);
          updateManifest(c.manifestPath, (m) => {
            m.instagramErrors = m.instagramErrors || {};
            const prev: FailureRecord | undefined = m.instagramErrors[c.file];
            m.instagramErrors[c.file] = { attempts: (prev?.attempts || 0) + 1, lastError: message, lastAttemptAt: new Date().toISOString() };
          });
          result.failed.push({ reference: c.reference, file: c.file, error: message });
          console.warn(`[instagram-sync] Failed to post ${c.reference} ${c.file}: ${message}`);
        } finally {
          inFlight.delete(lockKey);
        }
      }
      result.summary = `${candidates.length} awaiting public on YouTube; posted ${result.posted.length}, failed ${result.failed.length}.`;
    } else {
      result.summary = 'Nothing waiting to post.';
    }
  } catch (err: any) {
    result.summary = `Sync error: ${err?.message || err}`;
    console.warn('[instagram-sync]', result.summary);
  }

  state.lastRunAt = new Date().toISOString();
  state.lastSummary = result.summary;
  writeState(state);
  return result;
}

// Posts one library video to Instagram right now, from the library's "Instagram" button - no need to
// wait for it to go public on YouTube, or to be on YouTube at all. Caption from buildLibraryCaption.
// Recorded in manifest.instagram like a sync post, so the sync skips it.
export async function postLibraryVideoToInstagram(dir: string, file: string): Promise<Omit<PostedRecord, 'youtubeVideoId'> & { youtubeVideoId?: string }> {
  if (!isInstagramConfigured()) throw new Error('Instagram is not configured (set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env).');
  const lang = libraryVideoLang(file);
  if (!lang) throw new Error(`Not a library video: ${file}`);
  const { absPath } = resolveLibraryAsset(dir, file);
  const manifestPath = manifestPathFor(dir, file);
  const lockKey = `${manifestPath}::${file}`;

  const existing = readManifestAt(manifestPath).instagram?.[file];
  if (existing) throw new Error(`Already posted to Instagram${existing.permalink ? ` (${existing.permalink})` : ''}.`);
  if (inFlight.has(lockKey)) throw new Error('This video is already being posted to Instagram.');
  inFlight.add(lockKey);

  try {
    const manifest = readManifestAt(manifestPath);
    const { caption, youtubeVideoId } = await buildLibraryCaption(dir, file);

    const published = await publishReelFromFile(absPath, caption);
    const record = { ...published, postedAt: new Date().toISOString(), ...(youtubeVideoId ? { youtubeVideoId } : {}) };
    updateManifest(manifestPath, (m) => {
      m.instagram = m.instagram || {};
      m.instagram[file] = record;
      if (m.instagramErrors) delete m.instagramErrors[file];
      if (m.instagramScheduled) delete m.instagramScheduled[file];
    });
    console.info(`[instagram] Posted ${manifest.reference || dir} ${file} to Instagram: ${published.permalink || published.mediaId}`);
    return record;
  } finally {
    inFlight.delete(lockKey);
  }
}

// --- Scheduled posts ---
//
// Instagram's API has no scheduled publishing for Reels, so the schedule lives here: a chosen time
// per video in manifest.instagramScheduled[file], and a check every minute that posts whatever is
// due. The server has to be running at that time; if it was off, an overdue post goes out at the
// next check after it starts.

interface ScheduleRecord { at: string; scheduledAt: string; attempts?: number; lastError?: string; failed?: boolean }

export function scheduleLibraryVideoForInstagram(dir: string, file: string, at: string): ScheduleRecord {
  if (!isInstagramConfigured()) throw new Error('Instagram is not configured (set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env).');
  if (!libraryVideoLang(file)) throw new Error(`Not a library video: ${file}`);
  resolveLibraryAsset(dir, file);
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw new Error('Invalid date/time.');
  if (when.getTime() < Date.now() - 60_000) throw new Error('Pick a time in the future.');

  const manifestPath = manifestPathFor(dir, file);
  if (readManifestAt(manifestPath).instagram?.[file]) throw new Error('Already posted to Instagram.');
  const record: ScheduleRecord = { at: when.toISOString(), scheduledAt: new Date().toISOString() };
  updateManifest(manifestPath, (m) => {
    m.instagramScheduled = m.instagramScheduled || {};
    m.instagramScheduled[file] = record;
  });
  return record;
}

export function cancelInstagramSchedule(dir: string, file: string): void {
  updateManifest(manifestPathFor(dir, file), (m) => {
    if (m.instagramScheduled) delete m.instagramScheduled[file];
  });
}

let schedulerBusy = false;

async function runDueSchedules(): Promise<void> {
  if (schedulerBusy || !isInstagramConfigured()) return;
  schedulerBusy = true;
  try {
    for (const entry of listLibrary()) {
      for (const video of entry.videos) {
        const s = video.instagramScheduled;
        if (!s || s.failed || Date.parse(s.at) > Date.now()) continue;
        let manifestPath: string;
        try {
          manifestPath = manifestPathFor(entry.dir, video.file);
        } catch {
          continue;
        }
        try {
          // Clears the schedule entry itself on success.
          await postLibraryVideoToInstagram(entry.dir, video.file);
        } catch (err: any) {
          const message = err?.message || String(err);
          updateManifest(manifestPath, (m) => {
            const rec: ScheduleRecord | undefined = m.instagramScheduled?.[video.file];
            if (!rec) return;
            rec.attempts = (rec.attempts || 0) + 1;
            rec.lastError = message;
            if (rec.attempts >= MAX_ATTEMPTS) rec.failed = true;
          });
          console.warn(`[instagram-schedule] Failed to post ${entry.reference} ${video.file}: ${message}`);
        }
      }
    }
  } catch (err: any) {
    console.warn('[instagram-schedule]', err?.message || err);
  } finally {
    schedulerBusy = false;
  }
}

export function runInstagramSyncNow(): Promise<SyncRunResult> {
  if (!running) running = runOnce().finally(() => { running = null; });
  return running;
}

export function getInstagramSyncStatus() {
  const state = readState();
  const recent: { reference: string; file: string; permalink: string | null; postedAt: string }[] = [];
  const scheduled: { reference: string; dir: string; file: string; at: string; lastError?: string; failed?: boolean }[] = [];
  for (const entry of listLibrary()) {
    for (const video of entry.videos) {
      if (video.instagramScheduled) scheduled.push({ reference: entry.reference, dir: entry.dir, file: video.file, ...video.instagramScheduled });
      try {
        const posted = readManifestAt(manifestPathFor(entry.dir, video.file)).instagram?.[video.file];
        if (posted) recent.push({ reference: entry.reference, file: video.file, permalink: posted.permalink, postedAt: posted.postedAt });
      } catch { /* missing file - skip */ }
    }
  }
  recent.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  scheduled.sort((a, b) => a.at.localeCompare(b.at));
  return {
    instagramConfigured: isInstagramConfigured(),
    youtubeConfigured: isYoutubeUploadConfigured(),
    intervalMinutes: INTERVAL_MIN,
    enabledSince: process.env.INSTAGRAM_SYNC_SINCE || state.enabledSince || null,
    lastRunAt: state.lastRunAt || null,
    lastSummary: state.lastSummary || null,
    recentPosts: recent.slice(0, 10),
    scheduled,
  };
}

// Called once at server start: first pass shortly after boot, then every INTERVAL_MIN minutes.
export function startInstagramSync(): void {
  if (!isInstagramConfigured()) {
    console.info('[instagram-sync] Instagram not configured (INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID) - auto-posting is off.');
  }
  setTimeout(() => { void runInstagramSyncNow(); }, 30_000);
  setInterval(() => { void runInstagramSyncNow(); }, INTERVAL_MIN * 60_000);
  // Scheduled posts are checked every minute so they go out close to the chosen time.
  setTimeout(() => { void runDueSchedules(); }, 15_000);
  setInterval(() => { void runDueSchedules(); }, 60_000);
}
