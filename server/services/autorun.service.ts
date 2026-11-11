import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { listLibrary } from './library.service';
import { scheduleLibraryVideoEverywhere, type ScheduleAllResult } from './socialSchedule.service';
import { scheduleWhatsApp } from './whatsapp.service';

// Automatic daily run: generates a date's verse from the verse plan (data/verse-plan-*.json) with no
// one at the keyboard, then queues it on every channel for that date's go-live time.
//
// Generation itself runs in the browser (posters are drawn on a canvas and the browser drives the
// video steps), so this opens the app in a headless Chromium at /?autorun=<date>. The page fills in
// the plan's verse, runs the normal generation (which saves into output/), and POSTs its outcome to
// /api/autorun/report. The server then schedules every saved video (YouTube private + publishAt,
// Facebook scheduled post, Instagram in-app schedule) and the posters' WhatsApp queue entry.
//
// Triggered by POST /api/autorun/start - on Codespaces from the GitHub Action in
// .github/workflows/daily-autorun.yml (see scripts/autorun.sh). A date that already has a complete
// generation is not regenerated (unless forced) - only (re)scheduled, which is idempotent.

const PLAN_DIR = path.join(process.cwd(), 'data');
const LOG_PATH = path.join(process.cwd(), '.cache', 'autorun-log.json');
const LOG_KEEP = 60;
// Generous: a CPU-only Codespace run takes ~2-4 min; a slow AI provider day can take longer.
const GENERATION_TIMEOUT_MS = Number(process.env.AUTORUN_TIMEOUT_MIN || 25) * 60 * 1000;
// Narration + meditation videos for en/ta/te.
const EXPECTED_VIDEOS = 6;

export interface PlanEntry { date: string; reference: string; theme?: string }

export interface AutorunRecord {
  date: string;
  reference?: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'done' | 'partial' | 'skipped' | 'failed';
  dryRun?: boolean;
  detail?: string;
  generation?: { ok: boolean; error?: string; videos?: number; posters?: number };
  scheduled?: { file: string; result: ScheduleAllResult | { error: string } }[];
  whatsapp?: string;
}

let current: { record: AutorunRecord; promise: Promise<AutorunRecord> } | null = null;
let pendingReport: { date: string; resolve: (r: PageReport) => void } | null = null;

interface PageReport { date: string; ok: boolean; error?: string; videos?: number; posters?: number }

function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Tomorrow" in server local time (TZ is set to India time on Codespaces - see .devcontainer/start.sh).
export function tomorrowIsoDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localIsoDate(d);
}

export function findPlanEntry(date: string): PlanEntry | null {
  try {
    for (const file of fs.readdirSync(PLAN_DIR).filter((f) => /^verse-plan.*\.json$/.test(f))) {
      const entries = JSON.parse(fs.readFileSync(path.join(PLAN_DIR, file), 'utf-8')) as PlanEntry[];
      const hit = entries.find((e) => e.date === date);
      if (hit) return hit;
    }
  } catch (err: any) {
    console.warn('[autorun] Could not read verse plan:', err?.message || err);
  }
  return null;
}

function libraryEntryFor(date: string) {
  return listLibrary().find((e) => e.date === date) || null;
}

function isComplete(date: string): boolean {
  const entry = libraryEntryFor(date);
  return !!entry && entry.videos.length >= EXPECTED_VIDEOS && entry.posters.length > 0;
}

function readLog(): AutorunRecord[] {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')); } catch { return []; }
}

function writeLog(record: AutorunRecord): void {
  const log = readLog().filter((r) => !(r.startedAt === record.startedAt && r.date === record.date));
  log.unshift(record);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log.slice(0, LOG_KEEP), null, 2));
}

export function getAutorunStatus() {
  return { running: current?.record ?? null, recent: readLog().slice(0, 14), tomorrow: tomorrowIsoDate() };
}

function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Opens the app headless at /?autorun=<date> and waits for the page's report.
function runInHeadlessBrowser(date: string, port: number): Promise<PageReport> {
  const browser = findBrowser();
  if (!browser) {
    return Promise.reject(new Error('No Chrome/Chromium found for the headless run - install chromium (see .devcontainer/setup.sh) or set CHROME_PATH.'));
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autorun-chrome-'));
  const url = `http://localhost:${port}/?autorun=${encodeURIComponent(date)}`;
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--mute-audio', `--user-data-dir=${profileDir}`, '--window-size=1280,900',
    // Keep timers and rendering at full speed in a page nobody is looking at.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    // Keeps headless Chrome running (and the page alive) instead of exiting after load.
    '--remote-debugging-port=0',
    url,
  ];
  let proc: ChildProcess | null = null;
  return new Promise<PageReport>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReport = null;
      reject(new Error(`Generation did not finish within ${Math.round(GENERATION_TIMEOUT_MS / 60000)} minutes.`));
    }, GENERATION_TIMEOUT_MS);
    pendingReport = { date, resolve: (r) => { clearTimeout(timer); resolve(r); } };
    proc = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    proc.on('error', (err) => { clearTimeout(timer); pendingReport = null; reject(err); });
    proc.on('exit', (code) => {
      if (pendingReport?.date === date) {
        clearTimeout(timer);
        pendingReport = null;
        reject(new Error(`Headless browser exited (code ${code}) before generation finished: ${stderr.slice(-300)}`));
      }
    });
  }).finally(() => {
    try { proc?.kill('SIGKILL'); } catch { /* already gone */ }
    setTimeout(() => fs.rmSync(profileDir, { recursive: true, force: true }), 2000);
  });
}

// Called by the page (POST /api/autorun/report) when its generation finishes.
export function receiveAutorunReport(report: PageReport): boolean {
  if (!pendingReport || pendingReport.date !== report.date) return false;
  const { resolve } = pendingReport;
  pendingReport = null;
  resolve(report);
  return true;
}

// Queues every saved video and the posters for the date's go-live time. Idempotent: already
// uploaded/scheduled items are reported as such rather than duplicated.
async function scheduleDate(date: string, record: AutorunRecord): Promise<void> {
  const entry = libraryEntryFor(date);
  if (!entry) throw new Error(`No saved generation found for ${date}.`);
  record.scheduled = [];
  for (const video of entry.videos) {
    try {
      record.scheduled.push({ file: video.file, result: await scheduleLibraryVideoEverywhere(entry.dir, video.file, null) });
    } catch (err: any) {
      record.scheduled.push({ file: video.file, result: { error: err?.message || String(err) } });
    }
    writeLog(record);
  }
  try {
    const wa = entry.posters.length ? scheduleWhatsApp(entry.dir, null) : null;
    record.whatsapp = wa?.at ? `queued for ${wa.at}` : 'not queued';
  } catch (err: any) {
    record.whatsapp = `error: ${err?.message || err}`;
  }
}

// dryRun: generate but schedule nothing (for testing without publishing anywhere).
export function startAutorun(opts: { date?: string; force?: boolean; dryRun?: boolean; port: number }): Promise<AutorunRecord> {
  if (current) return current.promise;
  const date = opts.date || tomorrowIsoDate();
  const plan = findPlanEntry(date);
  const record: AutorunRecord = { date, reference: plan?.reference, startedAt: new Date().toISOString(), status: 'running', ...(opts.dryRun ? { dryRun: true } : {}) };
  writeLog(record);

  const promise = (async () => {
    try {
      if (!plan) {
        record.status = 'failed';
        record.detail = `No verse plan entry for ${date} - add the next quarter's plan to data/.`;
        return record;
      }
      if (isComplete(date) && !opts.force) {
        record.detail = 'Already generated - scheduling only.';
      } else {
        console.log(`[autorun] Generating ${date} (${plan.reference}) in a headless browser...`);
        const report = await runInHeadlessBrowser(date, opts.port);
        record.generation = { ok: report.ok, error: report.error, videos: report.videos, posters: report.posters };
        writeLog(record);
        if (!libraryEntryFor(date)) throw new Error(`Generation saved nothing for ${date}${report.error ? `: ${report.error}` : ''}.`);
      }
      if (opts.dryRun) {
        const entry = libraryEntryFor(date);
        record.detail = [record.detail, `Dry run - nothing scheduled. Would schedule: ${(entry?.videos || []).map((v) => v.file).join(', ') || 'nothing'}.`].filter(Boolean).join(' ');
      } else {
        await scheduleDate(date, record);
      }
      const problems = (record.scheduled || []).filter((s) => 'error' in s.result
        || Object.values(s.result).some((c: any) => c && typeof c === 'object' && c.state === 'error'));
      const incomplete = !isComplete(date) || (record.generation && !record.generation.ok);
      record.status = problems.length || incomplete ? 'partial' : record.detail && !opts.dryRun ? 'skipped' : 'done';
      if (incomplete && !record.detail) record.detail = record.generation?.error || 'Some items were not generated.';
      return record;
    } catch (err: any) {
      record.status = 'failed';
      record.detail = err?.message || String(err);
      return record;
    } finally {
      record.finishedAt = new Date().toISOString();
      writeLog(record);
      console.log(`[autorun] ${date}: ${record.status}${record.detail ? ` - ${record.detail}` : ''}`);
      current = null;
    }
  })();
  current = { record, promise };
  return promise;
}
