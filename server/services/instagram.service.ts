import fs from 'fs';

// Instagram publishing through Meta's official Instagram Graph API (Instagram professional account
// linked to a Facebook Page, with a long-lived token from a Meta app) - never username/password
// automation, which breaks Instagram's terms and gets accounts locked.
//
// Reels use the API's RESUMABLE upload: the video bytes are sent straight from this machine to
// rupload.facebook.com, so no public URL / tunnel is needed (image posts, by contrast, require a
// publicly hosted image_url, which is why only videos are auto-posted for now). Flow, per
// https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads:
//   1. POST /{ig-user-id}/media  media_type=REELS, upload_type=resumable, caption -> container id + uri
//   2. POST https://rupload.facebook.com/ig-api-upload/{version}/{container-id}  (binary body)
//   3. GET  /{container-id}?fields=status_code  until FINISHED
//   4. POST /{ig-user-id}/media_publish  creation_id={container-id}  -> media id

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || 'v23.0';
// Two token flavours exist: "Instagram API with Instagram Login" tokens (prefix IGAA/IG) only work
// on graph.instagram.com, while Facebook Login tokens (prefix EAA) only work on graph.facebook.com -
// sending one to the other host fails with "Invalid OAuth access token - Cannot parse access token".
function graphBase(): string {
  const host = /^IG/.test(token()) ? 'graph.instagram.com' : 'graph.facebook.com';
  return `https://${host}/${GRAPH_VERSION}`;
}
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000;
const PROCESSING_POLL_MS = 10_000;
// Instagram caption limits.
const MAX_CAPTION_CHARS = 2200;
const MAX_HASHTAGS = 30;
// Which frame becomes the Reel's cover. Instagram defaults to the first frame, and every video here
// fades in from black, so without this each Reel shows a black preview. By 2s the fade is long done.
const THUMB_OFFSET_MS = Number(process.env.INSTAGRAM_THUMB_OFFSET_MS) || 2000;

export function isInstagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID);
}

function token(): string {
  return process.env.INSTAGRAM_ACCESS_TOKEN!;
}

async function graph(method: 'GET' | 'POST', pathAndQuery: string, params: Record<string, string> = {}): Promise<any> {
  const url = `${graphBase()}/${pathAndQuery}`;
  const res = method === 'GET'
    ? await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token())}`)
    : await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, access_token: token() }).toString(),
    });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const e = data?.error;
    throw new Error(`Instagram API ${res.status}: ${e?.message || 'request failed'}${e?.error_user_msg ? ` - ${e.error_user_msg}` : ''}`);
  }
  return data;
}

// Keeps a caption within Instagram's limits: drops hashtags beyond the 30th and trims to 2,200
// characters at a line or word boundary.
export function fitInstagramCaption(caption: string): string {
  let count = 0;
  let text = caption.replace(/#[\p{L}\p{N}_]+/gu, (tag) => (++count <= MAX_HASHTAGS ? tag : '')).replace(/[ \t]+\n/g, '\n').trim();
  if (text.length > MAX_CAPTION_CHARS) {
    const cut = text.slice(0, MAX_CAPTION_CHARS);
    const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
    text = (boundary > MAX_CAPTION_CHARS * 0.8 ? cut.slice(0, boundary) : cut).trim();
  }
  return text;
}

export interface InstagramPublishResult {
  mediaId: string;
  permalink: string | null;
}

export async function publishReelFromFile(absPath: string, caption: string): Promise<InstagramPublishResult> {
  if (!isInstagramConfigured()) throw new Error('Instagram is not configured (set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env).');
  const userId = process.env.INSTAGRAM_USER_ID!;
  // Resumable (from-disk) uploads are only offered to Facebook Login tokens; graph.instagram.com
  // silently ignores upload_type=resumable and fails with "The parameter video_url is required".
  if (/^IG/.test(token())) {
    throw new Error('INSTAGRAM_ACCESS_TOKEN is an Instagram Login token (IGAA...), which cannot upload videos from disk. Use a Facebook Login Page token (EAA...) - see scripts/instagram_facebook_token.ts.');
  }

  const container = await graph('POST', `${userId}/media`, {
    media_type: 'REELS',
    upload_type: 'resumable',
    caption: fitInstagramCaption(caption),
    thumb_offset: String(THUMB_OFFSET_MS),
  });
  const containerId: string = container.id;
  if (!containerId) throw new Error('Instagram did not return a media container id');

  const video = fs.readFileSync(absPath);
  const uploadUrl: string = container.uri || `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${containerId}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token()}`,
      offset: '0',
      file_size: String(video.length),
    },
    body: video,
  });
  const uploadData: any = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || uploadData?.success === false || uploadData?.error) {
    throw new Error(`Instagram video upload failed (${uploadRes.status}): ${uploadData?.error?.message || uploadData?.debug_info?.message || 'unknown error'}`);
  }

  // Instagram transcodes the video before it can be published.
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  for (;;) {
    const status = await graph('GET', `${containerId}?fields=status_code,status`);
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`Instagram could not process the video (${status.status_code}: ${status.status || 'no detail'})`);
    }
    if (Date.now() > deadline) throw new Error('Instagram video processing did not finish within 10 minutes');
    await new Promise((r) => setTimeout(r, PROCESSING_POLL_MS));
  }

  const published = await graph('POST', `${userId}/media_publish`, { creation_id: containerId });
  const mediaId: string = published.id;
  let permalink: string | null = null;
  try {
    permalink = (await graph('GET', `${mediaId}?fields=permalink`)).permalink || null;
  } catch { /* published fine; the link is only for display */ }
  return { mediaId, permalink };
}
