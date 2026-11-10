import { Readable } from 'stream';
import { google, youtube_v3 } from 'googleapis';
import sharp from 'sharp';
import { sanitizeYoutubeTitle } from '../utils/youtubeTitle';

// Direct YouTube Data API v3 upload/playlist automation for this app's own church channel - not a
// multi-tenant integration, so a single refresh token (from scripts/youtube_authorize.ts's one-time
// OAuth flow) is enough; no per-request user auth. See that script's header for the one-time setup
// this depends on.
export const YOUTUBE_UPLOAD_VERSION = 1;

export function isYoutubeUploadConfigured(): boolean {
  return !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

function getYoutubeClient(): youtube_v3.Youtube {
  const oauth2Client = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return google.youtube({ version: 'v3', auth: oauth2Client });
}

function bufferToStream(buffer: Buffer): Readable {
  return Readable.from(buffer);
}

// YouTube rejects thumbnails over 2MB, and the bilingual 1080x1920 PNG posters reused as library
// thumbnails are routinely 2-2.5MB - so every thumbnail is re-encoded as a JPEG (which is also the
// mime type thumbnails.set declares), stepping quality down until it fits.
const YOUTUBE_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;

async function toYoutubeThumbnail(input: Buffer): Promise<Buffer> {
  const base = sharp(input).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#000' });
  for (const quality of [90, 80, 70, 60, 50]) {
    const jpeg = await base.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= YOUTUBE_THUMBNAIL_MAX_BYTES) return jpeg;
  }
  throw new Error('could not get the thumbnail under YouTube\'s 2MB limit');
}

export interface YoutubeUploadRequest {
  videoBuffer: Buffer;
  title: string;
  description: string;
  // "Bible" isn't a real YouTube category - 22 (People & Blogs) is the closest fit for devotional
  // content that isn't Music/Education-specific; kept as a plain constant rather than a lookup since
  // this app only ever uploads one kind of content.
  categoryId?: string;
  tags?: string[];
  privacyStatus?: 'private' | 'unlisted' | 'public';
  // Scheduled go-live: the video is uploaded private and YouTube makes it public at this time.
  publishAt?: Date;
  thumbnailBuffer?: Buffer;
  // Localized series display name (see ai/youtubeMetadata.ts's SERIES_DISPLAY_NAMES) - if given, the
  // video is added to a playlist of this exact title, creating it first if it doesn't exist yet.
  // This is what actually turns the app's existing series labels into real, browsable YouTube
  // playlists (previously just text in the description) - see manifest.service.ts's SERIES_KEYS
  // callers.
  playlistTitle?: string;
}

export interface YoutubeUploadResult {
  videoId: string;
  videoUrl: string;
  playlistId?: string;
}

async function findOrCreatePlaylist(youtube: youtube_v3.Youtube, title: string): Promise<string> {
  const existing = await youtube.playlists.list({ part: ['snippet'], mine: true, maxResults: 50 });
  const match = existing.data.items?.find((p) => p.snippet?.title === title);
  if (match?.id) return match.id;

  const created = await youtube.playlists.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title },
      status: { privacyStatus: 'public' },
    },
  });
  if (!created.data.id) throw new Error('Playlist creation returned no id');
  return created.data.id;
}

// Uploads one video (resumable upload under the hood, handled by googleapis), then best-effort sets
// its thumbnail and/or adds it to a playlist - a failure in either of those doesn't undo the upload
// itself (the video is the actual deliverable), it's surfaced back to the caller as a warning instead.
export async function uploadVideoToYoutube(req: YoutubeUploadRequest): Promise<YoutubeUploadResult & { warnings: string[] }> {
  const youtube = getYoutubeClient();
  const warnings: string[] = [];
  // Re-sanitized here, not just at metadata validation, because cached metadata and titles sent
  // from the UI reach this point without passing back through validate().
  const title = sanitizeYoutubeTitle(req.title);
  if (!title) throw new Error('Title is empty after cleanup');

  const insertResp = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: req.description,
        tags: req.tags,
        categoryId: req.categoryId || '22',
      },
      status: req.publishAt
        ? { privacyStatus: 'private', publishAt: req.publishAt.toISOString(), selfDeclaredMadeForKids: false }
        : { privacyStatus: req.privacyStatus || 'public', selfDeclaredMadeForKids: false },
    },
    media: { body: bufferToStream(req.videoBuffer) },
  });

  const videoId = insertResp.data.id;
  if (!videoId) throw new Error('YouTube upload returned no video id');

  if (req.thumbnailBuffer) {
    try {
      const thumbnail = await toYoutubeThumbnail(req.thumbnailBuffer);
      await youtube.thumbnails.set({ videoId, media: { body: bufferToStream(thumbnail), mimeType: 'image/jpeg' } });
    } catch (err: any) {
      warnings.push(`Thumbnail upload failed: ${err?.message || err}`);
    }
  } else {
    warnings.push('No thumbnail image was available; YouTube will pick a frame.');
  }

  let playlistId: string | undefined;
  if (req.playlistTitle) {
    try {
      playlistId = await findOrCreatePlaylist(youtube, req.playlistTitle);
      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: { snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } } },
      });
    } catch (err: any) {
      warnings.push(`Playlist assignment failed: ${err?.message || err}`);
    }
  }

  for (const warning of warnings) console.warn(`[youtube] ${videoId}: ${warning}`);
  return { videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}`, playlistId, warnings };
}

// Moves an already-uploaded, still-private video's scheduled go-live to `at`. Only private videos
// can carry a publishAt, so one that is already public is left alone.
export async function setYoutubePublishAt(videoId: string, at: Date): Promise<boolean> {
  const youtube = getYoutubeClient();
  const current = (await youtube.videos.list({ part: ['status'], id: [videoId] })).data.items?.[0];
  if (!current) throw new Error('Video not found on YouTube.');
  if (current.status?.privacyStatus !== 'private') return false;
  await youtube.videos.update({
    part: ['status'],
    requestBody: {
      id: videoId,
      status: { privacyStatus: 'private', publishAt: at.toISOString(), selfDeclaredMadeForKids: current.status?.selfDeclaredMadeForKids ?? false },
    },
  });
  return true;
}

export interface YoutubeVideoState {
  privacyStatus: string;
  title: string;
  description: string;
}

// Current privacy + title/description for up to any number of this channel's videos (batched 50 per
// call, 1 quota unit each) - used by the Instagram sync to spot uploads that have gone public, and to
// reuse their final title/description as the Reel caption. Videos deleted from YouTube are simply
// absent from the result.
export async function getYoutubeVideoStates(videoIds: string[]): Promise<Map<string, YoutubeVideoState>> {
  const youtube = getYoutubeClient();
  const states = new Map<string, YoutubeVideoState>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const resp = await youtube.videos.list({ part: ['status', 'snippet'], id: videoIds.slice(i, i + 50), maxResults: 50 });
    for (const item of resp.data.items || []) {
      if (!item.id) continue;
      states.set(item.id, {
        privacyStatus: item.status?.privacyStatus || 'unknown',
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
      });
    }
  }
  return states;
}
