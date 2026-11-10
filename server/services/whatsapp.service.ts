import fs from 'fs';
import path from 'path';
import { listLibrary, libraryEntryDate, resolveLibraryAsset } from './library.service';
import { getDailyVerse } from './verse.service';
import { analyzeVerseWithClaude } from '../../ai/analyzer';
import { generatePostCaptions } from '../../ai/postCaption';
import { upcomingPostTime, MIN_SCHEDULE_LEAD_MS } from '../utils/postTime';

// WhatsApp Channel posting queue for the bilingual verse posters. WhatsApp has no API for posting to
// Channels (Meta's Business API doesn't cover them, and the automated alternatives drive a linked
// WhatsApp Web session, which breaks WhatsApp's terms and risks the number being banned). So the
// schedule lives here and the posting is a tap: each verse's posters are scheduled for its date
// (same go-live time as every other channel, see utils/postTime.ts), and once due they show in the
// app's WhatsApp queue with their caption ready - share or copy, post in WhatsApp, mark posted.
//
// Stored per verse in manifest.whatsapp = { at, scheduledAt, posted: { [poster]: postedAt }, captions }.

const OUTPUT_DIR = path.join(process.cwd(), 'output');
export const WHATSAPP_CHANNEL_URL = process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029VbBlepcGehEPFRz70c1x';
const WHATSAPP_POSTERS: { file: string; label: string; captionKey: 'tamil' | 'telugu' }[] = [
  { file: 'tamil-english.png', label: 'Tamil + English', captionKey: 'tamil' },
  { file: 'telugu-english.png', label: 'Telugu + English', captionKey: 'telugu' },
];

export interface WhatsAppRecord {
  at: string;
  scheduledAt: string;
  posted?: Record<string, string>;
  captions?: { tamil: string; telugu: string };
}

function manifestPath(dir: string): string {
  const abs = path.resolve(OUTPUT_DIR, dir);
  if (!abs.startsWith(path.resolve(OUTPUT_DIR) + path.sep)) throw new Error('Invalid library directory.');
  return path.join(abs, 'manifest.json');
}

function readManifest(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(dir), 'utf-8'));
  } catch {
    return {};
  }
}

function updateManifest(dir: string, mutate: (m: any) => void): void {
  const m = readManifest(dir);
  mutate(m);
  fs.writeFileSync(manifestPath(dir), JSON.stringify(m, null, 2));
}

function postersOf(dir: string) {
  return WHATSAPP_POSTERS.filter((p) => {
    try {
      resolveLibraryAsset(dir, p.file);
      return true;
    } catch {
      return false;
    }
  });
}

// Schedules a verse's posters for `at` (ISO), or for its own date when `at` is omitted. Returns
// null without scheduling when the verse's date has already passed (it stays unposted, like the
// other channels) - an explicit `at` must be in the future.
export function scheduleWhatsApp(dir: string, at?: string | null): WhatsAppRecord | null {
  if (!postersOf(dir).length) throw new Error('This verse has no posters to post.');
  let when: Date | null;
  if (at) {
    when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new Error('Invalid date/time.');
    if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) throw new Error('Pick a time at least 10 minutes from now.');
  } else {
    when = upcomingPostTime(libraryEntryDate(dir));
  }
  if (!when) return null;
  let record: WhatsAppRecord | null = null;
  updateManifest(dir, (m) => {
    record = { ...(m.whatsapp || {}), at: when!.toISOString(), scheduledAt: new Date().toISOString() };
    m.whatsapp = record;
  });
  return record;
}

export function cancelWhatsApp(dir: string): void {
  updateManifest(dir, (m) => {
    // Keep the posted marks if some posters already went out; only the schedule goes.
    if (m.whatsapp?.posted && Object.keys(m.whatsapp.posted).length) delete m.whatsapp.at;
    else delete m.whatsapp;
  });
}

// Posters are posted by hand, so this is how the queue learns one is done.
export function markWhatsAppPosted(dir: string, file: string, posted: boolean): void {
  if (!WHATSAPP_POSTERS.some((p) => p.file === file)) throw new Error(`Not a WhatsApp poster: ${file}`);
  updateManifest(dir, (m) => {
    m.whatsapp = m.whatsapp || { at: new Date().toISOString(), scheduledAt: new Date().toISOString() };
    m.whatsapp.posted = m.whatsapp.posted || {};
    if (posted) m.whatsapp.posted[file] = new Date().toISOString();
    else delete m.whatsapp.posted[file];
  });
}

// Captions are written once per verse (Claude, disk-cached; plain verse captions if Claude is
// unavailable) and stored in the manifest, so the queue doesn't regenerate them on every refresh.
async function captionsFor(dir: string, reference: string): Promise<{ tamil: string; telugu: string } | null> {
  const stored = readManifest(dir).whatsapp?.captions;
  if (stored) return stored;
  try {
    const verse = getDailyVerse(reference);
    if (!verse.english || !verse.tamil || !verse.telugu) return null;
    const analysis = await analyzeVerseWithClaude(reference, verse.english.text, verse.tamil.text, verse.telugu.text).catch(() => null);
    const captions = await generatePostCaptions({
      reference,
      english: verse.english.text,
      tamil: verse.tamil.text,
      telugu: verse.telugu.text,
      tamilReference: verse.tamil.reference,
      teluguReference: verse.telugu.reference,
      viewerSituation: analysis?.viewerSituation,
      emotionalHook: analysis?.emotionalHook,
    });
    updateManifest(dir, (m) => {
      if (m.whatsapp) m.whatsapp.captions = captions;
    });
    return captions;
  } catch (err: any) {
    console.warn(`[whatsapp] Caption for ${reference} failed:`, err?.message || err);
    return null;
  }
}

// Caption for one poster on its own (the library's WhatsApp button, outside the queue).
export async function whatsAppPosterCaption(dir: string, file: string): Promise<string | null> {
  const poster = WHATSAPP_POSTERS.find((p) => p.file === file);
  if (!poster) throw new Error(`Not a WhatsApp poster: ${file}`);
  const reference = readManifest(dir).reference;
  if (!reference) return null;
  return (await captionsFor(dir, reference))?.[poster.captionKey] ?? null;
}

export interface WhatsAppQueueItem {
  dir: string;
  reference: string;
  date: string;
  at: string;
  posters: { file: string; label: string; postedAt: string | null; caption: string | null }[];
}

// Everything scheduled and not yet fully posted: `due` (time reached - captions included) and
// `upcoming` (no captions yet; they're written when the item comes due).
export async function getWhatsAppQueue(): Promise<{ channelUrl: string; due: WhatsAppQueueItem[]; upcoming: WhatsAppQueueItem[] }> {
  const due: WhatsAppQueueItem[] = [];
  const upcoming: WhatsAppQueueItem[] = [];
  for (const entry of listLibrary()) {
    const record: WhatsAppRecord | undefined = readManifest(entry.dir).whatsapp;
    if (!record?.at) continue;
    const posters = postersOf(entry.dir);
    if (!posters.length || posters.every((p) => record.posted?.[p.file])) continue;
    const isDue = Date.parse(record.at) <= Date.now();
    const captions = isDue ? await captionsFor(entry.dir, entry.reference) : null;
    const item: WhatsAppQueueItem = {
      dir: entry.dir,
      reference: entry.reference,
      date: entry.date,
      at: record.at,
      posters: posters.map((p) => ({
        file: p.file,
        label: p.label,
        postedAt: record.posted?.[p.file] ?? null,
        caption: captions?.[p.captionKey] ?? null,
      })),
    };
    (isDue ? due : upcoming).push(item);
  }
  due.sort((a, b) => a.at.localeCompare(b.at));
  upcoming.sort((a, b) => a.at.localeCompare(b.at));
  return { channelUrl: WHATSAPP_CHANNEL_URL, due, upcoming };
}
