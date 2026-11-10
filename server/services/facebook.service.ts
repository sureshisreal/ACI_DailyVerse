import fs from 'fs';
import path from 'path';
import { resolveLibraryAsset, buildLibraryCaption, libraryVideoKind } from './library.service';
import { MIN_SCHEDULE_LEAD_MS } from '../utils/postTime';

// Facebook Page publishing through Meta's Graph API, for the same library videos that go to YouTube
// and Instagram. Nothing goes public from here: every video is uploaded either as an unpublished
// DRAFT (finish and publish it from Meta Business Suite) or SCHEDULED with Facebook's own
// scheduled_publish_time - unlike the Instagram schedule, Facebook holds the post itself, so it goes
// out at that time even if this app is off.
//
// Portrait Shorts go up as Page Reels (resumable upload, sent straight from disk):
//   1. POST /{page-id}/video_reels  upload_phase=start                -> video_id
//   2. POST https://rupload.facebook.com/video-upload/{version}/{video_id}  (binary body)
//   3. POST /{page-id}/video_reels  upload_phase=finish, video_state=DRAFT|SCHEDULED
// Landscape meditation videos go up as ordinary Page videos (POST graph-video /{page-id}/videos,
// multipart) with published=false, plus scheduled_publish_time when scheduled.
//
// Needs a Page access token with pages_manage_posts, pages_read_engagement and publish_video -
// scripts/instagram_facebook_token.ts prints FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN.

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || process.env.INSTAGRAM_GRAPH_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
const MAX_TITLE_CHARS = 255;

function pageId(): string {
  return process.env.FACEBOOK_PAGE_ID!;
}

function token(): string {
  return process.env.FACEBOOK_PAGE_ACCESS_TOKEN!;
}

export function isFacebookConfigured(): boolean {
  return Boolean(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
}

async function parse(res: Response, what: string): Promise<any> {
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error || data?.success === false) {
    const e = data?.error;
    throw new Error(`Facebook ${what} failed (${res.status}): ${e?.message || data?.debug_info?.message || 'request failed'}${e?.error_user_msg ? ` - ${e.error_user_msg}` : ''}`);
  }
  return data;
}

async function graphPost(url: string, params: Record<string, string>, what: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, access_token: token() }).toString(),
  });
  return parse(res, what);
}

export interface FacebookUploadOptions {
  description: string;
  title: string;
  // Unset = unpublished draft.
  scheduledFor?: Date;
}

async function uploadReel(absPath: string, opts: FacebookUploadOptions): Promise<string> {
  const start = await graphPost(`${GRAPH}/${pageId()}/video_reels`, { upload_phase: 'start' }, 'Reel upload start');
  const videoId: string = start.video_id;
  if (!videoId) throw new Error('Facebook did not return a Reel video id');

  const video = fs.readFileSync(absPath);
  const uploadUrl: string = start.upload_url || `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${videoId}`;
  await parse(await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token()}`, offset: '0', file_size: String(video.length) },
    body: video,
  }), 'Reel video upload');

  await graphPost(`${GRAPH}/${pageId()}/video_reels`, {
    upload_phase: 'finish',
    video_id: videoId,
    description: opts.description,
    title: opts.title.slice(0, MAX_TITLE_CHARS),
    ...(opts.scheduledFor
      ? { video_state: 'SCHEDULED', scheduled_publish_time: String(Math.floor(opts.scheduledFor.getTime() / 1000)) }
      : { video_state: 'DRAFT' }),
  }, 'Reel finish');
  return videoId;
}

async function uploadPageVideo(absPath: string, opts: FacebookUploadOptions): Promise<string> {
  const form = new FormData();
  form.set('access_token', token());
  form.set('title', opts.title.slice(0, MAX_TITLE_CHARS));
  form.set('description', opts.description);
  form.set('published', 'false');
  if (opts.scheduledFor) form.set('scheduled_publish_time', String(Math.floor(opts.scheduledFor.getTime() / 1000)));
  form.set('source', new Blob([fs.readFileSync(absPath)], { type: 'video/mp4' }), path.basename(absPath));
  const data = await parse(await fetch(`${GRAPH_VIDEO}/${pageId()}/videos`, { method: 'POST', body: form }), 'video upload');
  if (!data.id) throw new Error('Facebook did not return a video id');
  return data.id;
}

// --- Library videos ---

export interface FacebookRecord {
  videoId: string;
  url: string;
  state: 'draft' | 'scheduled';
  scheduledFor?: string;
  uploadedAt: string;
  youtubeVideoId?: string;
}

const inFlight = new Set<string>();

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

// Uploads one library video to the Facebook Page: as an unpublished draft when `at` is null, or
// scheduled to publish at `at` (ISO time). Recorded in manifest.facebook[file] so it is never
// uploaded twice. Caption from buildLibraryCaption, the same one Instagram gets.
export async function sendLibraryVideoToFacebook(dir: string, file: string, at: string | null): Promise<FacebookRecord> {
  if (!isFacebookConfigured()) throw new Error('Facebook is not configured (set FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN in .env).');
  const kind = libraryVideoKind(file);
  if (!kind) throw new Error(`Not a library video: ${file}`);

  let scheduledFor: Date | undefined;
  if (at) {
    scheduledFor = new Date(at);
    if (Number.isNaN(scheduledFor.getTime())) throw new Error('Invalid date/time.');
    if (scheduledFor.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) throw new Error('Facebook needs a time at least 10 minutes from now.');
  }

  const { absPath } = resolveLibraryAsset(dir, file);
  const manifestPath = manifestPathFor(dir, file);
  const lockKey = `${manifestPath}::${file}`;
  const existing: FacebookRecord | undefined = readManifestAt(manifestPath).facebook?.[file];
  if (existing) throw new Error(`Already on Facebook (${existing.state}).`);
  if (inFlight.has(lockKey)) throw new Error('This video is already being uploaded to Facebook.');
  inFlight.add(lockKey);

  try {
    const { caption, title, youtubeVideoId } = await buildLibraryCaption(dir, file);
    const opts = { description: caption, title, scheduledFor };
    const videoId = kind === 'short' ? await uploadReel(absPath, opts) : await uploadPageVideo(absPath, opts);
    const record: FacebookRecord = {
      videoId,
      url: kind === 'short' ? `https://www.facebook.com/reel/${videoId}` : `https://www.facebook.com/${videoId}`,
      state: scheduledFor ? 'scheduled' : 'draft',
      ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
      uploadedAt: new Date().toISOString(),
      ...(youtubeVideoId ? { youtubeVideoId } : {}),
    };
    const manifest = readManifestAt(manifestPath);
    manifest.facebook = manifest.facebook || {};
    manifest.facebook[file] = record;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.info(`[facebook] ${record.state === 'draft' ? 'Drafted' : `Scheduled for ${record.scheduledFor}`} ${manifest.reference || dir} ${file}: ${videoId}`);
    return record;
  } finally {
    inFlight.delete(lockKey);
  }
}
