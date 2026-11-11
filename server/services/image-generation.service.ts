import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Background-image engine for this app: Pollinations.ai (https://pollinations.ai) - a free,
// keyless hosted API in front of open-weight text-to-image models. This used to run locally via
// ComfyUI (FLUX/SDXL), but on this machine's 18GB unified memory any local diffusion model
// thrashed system swap (13GB+ swapped, 200+ seconds per sampler step, sometimes a Float8_e4m3fn
// MPS crash on top) - so generation moved to a hosted API instead. This service makes one HTTP GET
// per background image; no model inference runs in this process or on this machine.

// Bumped to 12: Pro-quality cinematic upgrade across the entire stack.
//
// 1. Prompt engineering: every visual concept across all 20 BibleThemeKeys rewritten with
//    reference-level storytelling (bread-sharing documentary realism, desert olive tree, golden
//    wheat field with split-rail fence, warrior on horseback epic), specific focal-length lens
//    specs per theme (85mm f/1.4 for provision/tenderness, 70-200mm f/2.8 for recovery/triumph,
//    24-70mm f/8 for creation/landscape, 100mm macro for healing/close-up), explicit Kodak Portra
//    400 / Ektar 100 / Vision3 500T / Fuji Velvia 50 film-stock emulation per theme's emotional
//    register, and partial-body (chest/shoulders/waist down only, head excluded) crops baked into
//    every single human-figure concept so models have no structural way to place a head high.
//
// 2. Figure-free fallbacks: all 20 theme's fallback prompts rewritten with the same pro quality
//    cues - specific film stocks, tangible texture descriptions, concrete lens/aperture numbers,
//    precise atmospheric detail (pollen motes, salt-mist haze, curling tea steam, drifting
//    feather petals), and explicit "no" exclusions tailored to each scene (not just generic
//    "no people").
//
// 3. Vision review QA: new "proQuality" fourth independent checkbox (in addition to suitable,
//    relevant, christian) with a 5-dimensional hard gate: (1) realistic single-direction lighting
//    with no blown highlights / crushed blacks, (2) tangible texture on stone / wood / fabric /
//    bread crust / bark, not smooth plastic, (3) natural color science with no banded skies or
//    oversaturated neon, (4) real 3D depth via atmospheric haze and not flat same-plane
//    rendering, (5) no visible AI artifacts (fused fingers, repeating stone tile textures,
//    floating objects with no shadow). Any dimension fails = proQuality=false = regenerate.
//
// 4. Prompt normalization: CINEMATIC_QUALITY_SUFFIX, GENERIC_NEGATIVE_DEFAULTS,
//    COMPOSITION_PLACEMENT_GUARANTEE, and buildStandardizedPrompt() all enriched with ARRI/RED
//    camera names, Portra/Ektar film names, richer anti-artifact negative terms, and a deliberate
//    "fill the lower zone, no tiny subject lost in space" composition directive.
//
// Invalidation is intentional: every verse's cache key now includes the bumped version, so the
// first run after this deploy regenerates every background at the new quality level instead of
// silently pulling the old v11/v1 cached generics.
//
// Bumped to 13: default model switched from 'flux-schnell' to 'turbo' (see getModel() below) -
// every image cached under the old model gets regenerated instead of silently continuing to serve
// the flat-lit, plastic-skinned flux-schnell results the Vision reviewer was independently rejecting.
//
// Bumped to 14: moved to Pollinations' keyed API (gen.pollinations.ai) - see getModel() below.
export const IMAGE_GENERATOR_VERSION = 14;

// Pollinations' current API. Needs POLLINATIONS_API_KEY (https://enter.pollinations.ai); billed in
// pollen per image, no watermark, and a real choice of models.
const GEN_IMAGE_BASE = 'https://gen.pollinations.ai/image';
const GEN_MODELS_URL = 'https://gen.pollinations.ai/image/models';
// Legacy keyless endpoint, used only when no key is set. Verified 2026-10-02: whatever `model` is
// requested, it serves "sana" (response header x-model-used: sana), which the new API's model list
// maps to lykon/dreamshaper-8-lcm - an SD1.5-class model that reads only ~77 CLIP tokens of the
// prompt (Claude's prompts run ~200 words, so the composition/crop/subject details at the end were
// silently dropped) and stamps a "pollinations.ai" watermark in the bottom-right corner regardless
// of nologo. Poor prompt adherence from this model is why backgrounds stopped matching their verse.
const LEGACY_IMAGE_BASE = 'https://image.pollinations.ai/prompt';
const LEGACY_MODELS_URL = 'https://image.pollinations.ai/models';

// Default keyed model: Z-Image Turbo - photorealistic, follows long prompts, 0.004 pollen/image and
// 100% healthy on the models list at the time of the switch. Override with POLLINATIONS_MODEL using
// any name or alias from GEN_MODELS_URL (e.g. "microsoft/mai-image-2.6" for stronger instruction
// following, "black-forest-labs/flux.2-pro" for higher fidelity at higher cost).
const DEFAULT_KEYED_MODEL = 'tongyi-mai/z-image-turbo';

function getApiKey(): string | null {
  return process.env.POLLINATIONS_API_KEY || null;
}

function getModel(): string {
  return process.env.POLLINATIONS_MODEL || (getApiKey() ? DEFAULT_KEYED_MODEL : 'sana');
}

// Free community models on the keyed API (no pollen price on GEN_MODELS_URL), tried in order when
// the account can't pay for the main model (out of pollen credits). Lower quality than the paid
// default, but each is generated from this verse's prompt and still goes through the background
// review, which beats an unrelated stock photo. SDXL Lightning first: it honours the requested
// portrait size. FLUX.2 dev always returns 1024x1024, so its output is cropped to the requested
// aspect ratio (see fitToRequestedAspect) - otherwise the review rejects it outright as not
// portrait. Verified working 2026-11-11. Override with POLLINATIONS_FREE_MODELS (comma list; empty
// string disables).
const DEFAULT_FREE_MODELS = 'community/scriptsnsenses-sys/sdxl-lightning-free,community/scriptsnsenses-sys/flux-2-dev-free';
function getFreeModels(): string[] {
  const raw = process.env.POLLINATIONS_FREE_MODELS ?? DEFAULT_FREE_MODELS;
  return raw.split(',').map((m) => m.trim()).filter((m) => m && m !== getModel());
}
// After the account is refused for the main model, go straight to the free models for a while
// instead of paying for a failing round trip on every image.
const PAID_MODEL_COOLDOWN_MS = 30 * 60 * 1000;
let paidModelRefusedUntil = 0;

let warnedNoKey = false;

// Pollinations' free anonymous tier allows only one in-flight request per IP - a second concurrent
// request gets rejected outright ("Queue full for IP ...: 1 requests already queued (max: 1)"), not
// just slowed down. Verified directly: Bulk mode firing several verses' generation in parallel (see
// DailyVerseGenerator.tsx's runBulkGenerate) sent every verse's background-image request at once and
// all but one came back 429. This queue serializes just the actual HTTP call below (plain
// promise-chain mutex, same pattern as server.ts's indicParlerQueue for Indic-Parler) so callers -
// including several concurrent Bulk mode verses - can still fire requests in parallel; they just wait
// their turn for this one external, single-concurrency-limited call instead of colliding.
let pollinationsQueue: Promise<any> = Promise.resolve();
function runPollinationsSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = pollinationsQueue.then(fn);
  pollinationsQueue = result.catch(() => {}); // one call's failure shouldn't jam the queue for the next
  return result;
}

// Identifies this app to Pollinations per their documented (keyless) web-app convention, which
// gets a looser anonymous rate limit than an unidentified caller - no account/API key needed.
// Override via POLLINATIONS_REFERRER if this app is ever deployed under a real domain.
function getReferrer(): string {
  return process.env.POLLINATIONS_REFERRER || 'daily-bible-verse-generator';
}

interface GenerateBackgroundRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  cacheKey: string;
  // See commitBackgroundToCache below - lets a caller that reviews the result before trusting it
  // (verse.routes.ts's generateReviewedBackground) defer the actual cache write until it knows the
  // image is one worth persisting under this key, instead of every fetch unconditionally committing.
  skipCacheWrite?: boolean;
  // "Regenerate image" (verse.routes.ts's /verse/analyze, forceRegenerate in the request body):
  // skips the cache READ below so a verse that already has a cached background still gets a brand
  // new Pollinations call (new random seed, same prompt/concept/color-grade) instead of silently
  // returning the same photo again. The write below is untouched, so the fresh result still lands
  // under the same cacheKey and replaces what was there - one current image per verse, and every
  // later non-forced request (including this verse's own video/meditation generation later in the
  // same run) picks up the new one.
  forceRegenerate?: boolean;
}

interface GenerateBackgroundResult {
  imageBase64: string;
  contentType: string;
  width: number;
  height: number;
  cached: boolean;
  // 'stock' = Pollinations was unavailable even after retries and this is an arbitrary Picsum
  // photo with no relation to the verse or prompt - see fetchPicsumFallback. Never written to the
  // cache, and surfaced to the client so it can say so instead of quietly shipping it.
  source: 'pollinations' | 'stock';
}

const CACHE_DIR = path.join(process.cwd(), 'cache', 'images');

function cachePathFor(cacheKey: string): string {
  return path.join(CACHE_DIR, `${cacheKey}.jpg`);
}

function readImageCache(cacheKey: string): string | null {
  try {
    const file = cachePathFor(cacheKey);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file).toString('base64');
  } catch {
    return null;
  }
}

function writeImageCache(cacheKey: string, buffer: Buffer): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePathFor(cacheKey), buffer);
  } catch (err) {
    console.warn('[image-generation] Failed to write image cache:', err);
  }
}

// Explicit, caller-triggered cache commit for a result generateBackground returned with
// skipCacheWrite: true - see generateReviewedBackground in verse.routes.ts, which only calls this
// once a candidate has actually passed (or is being accepted as the best-effort last resort after)
// composition review, so a rejected image never gets written under the deterministic cache key a
// future request would trust as a silent cache hit.
export function commitBackgroundToCache(cacheKey: string, imageBase64: string): void {
  writeImageCache(cacheKey, Buffer.from(imageBase64, 'base64'));
}

// Deterministic sanity check only - no AI/vision QA. Pollinations doesn't guarantee it honors the
// exact requested pixel dimensions (it snaps to its backend model's native resolutions), so this
// only confirms the response is really a non-trivial image - the poster renderer already
// cover-fit-scales whatever size actually comes back (see components/posterRenderer.ts).
function looksLikeImage(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 200) return false;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  return isJpeg || isPng || isWebp;
}

// Picsum.photos fallback - the absolute last resort when Pollinations is still failing after
// retries, so poster generation is never blocked outright. Picsum has no search: a seed only picks
// an arbitrary photo from its catalog deterministically, so the result has NO relation to the
// verse or prompt (the old theme-named seed pools, e.g. "aci-dawn-mountain-...", never actually
// steered content - Lamentations 3:24's HOPE seed returned a farm hay baler). Callers get
// source: 'stock' and must treat it accordingly. No `grayscale` param: Picsum treats its mere
// presence (even "grayscale=0") as "make it grayscale", which is why every past fallback was B&W.
async function fetchPicsumFallback(
  cacheKey: string,
  width: number,
  height: number
): Promise<{ buffer: Buffer; contentType: string }> {
  const seed = encodeURIComponent(cacheKey.slice(0, 16) || 'aci-devotional');
  const url = `https://picsum.photos/seed/${seed}/${width}/${height}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`Picsum fallback returned ${res.status}`);
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!looksLikeImage(buffer)) throw new Error('Picsum fallback returned an invalid image.');
    return { buffer, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Transient Pollinations failures (rate limit, 5xx, timeout, network, empty body) are retried with
// these waits before giving up to the stock fallback - a single hiccup used to drop straight to an
// unrelated Picsum photo. Auth failures (401/403) and other 4xx aren't retried: they won't fix
// themselves within seconds.
const POLLINATIONS_RETRY_DELAYS_MS = [5000, 15000];

class PollinationsError extends Error {
  // accountProblem: the keyed API refused this account (out of pollen credits, or an invalid key).
  // The keyless legacy endpoint can still produce a verse-relevant image in that case - see
  // generateBackground - which beats an unrelated Picsum photo.
  constructor(message: string, readonly retryable: boolean, readonly accountProblem = false) {
    super(message);
  }
}

function buildLegacyUrl(req: GenerateBackgroundRequest, width: number, height: number, seed: number): URL {
  const url = new URL(`${LEGACY_IMAGE_BASE}/${encodeURIComponent(req.prompt)}`);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(height));
  url.searchParams.set('seed', String(seed));
  url.searchParams.set('nologo', 'true');
  url.searchParams.set('referrer', getReferrer());
  // The legacy endpoint serves "sana" whatever is asked for; a keyed model name means nothing here.
  url.searchParams.set('model', 'sana');
  if (req.negativePrompt) url.searchParams.set('negative_prompt', req.negativePrompt);
  return url;
}

// The legacy keyless endpoint stamps "pollinations.ai" into the bottom-right corner (~4% of the
// height) regardless of nologo. Trim the bottom 6% so it never reaches a poster or video frame -
// the renderers cover-fit whatever aspect comes back, so the slightly shorter image is harmless.
// Some models ignore the requested size (FLUX.2 dev free always returns a square). Center-crop to
// the requested aspect ratio and resize to the requested size, so the poster layout and the
// background review get the portrait frame they expect. No-op when the shape already matches.
async function fitToRequestedAspect(buffer: Buffer, contentType: string, width: number, height: number): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const meta = await sharp(buffer).metadata();
    if (!meta.width || !meta.height) return { buffer, contentType };
    if (Math.abs(meta.width / meta.height - width / height) < 0.02) return { buffer, contentType };
    const resized = await sharp(buffer).resize(width, height, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer();
    return { buffer: resized, contentType: 'image/jpeg' };
  } catch (err) {
    console.warn('[image-generation] Aspect fit failed, keeping image as-is:', err instanceof Error ? err.message : err);
    return { buffer, contentType };
  }
}

async function cropLegacyWatermark(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const img = sharp(buffer);
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return { buffer, contentType };
    const keepHeight = Math.round(meta.height * 0.94);
    const cropped = await img.extract({ left: 0, top: 0, width: meta.width, height: keepHeight }).jpeg({ quality: 92 }).toBuffer();
    return { buffer: cropped, contentType: 'image/jpeg' };
  } catch (err) {
    console.warn('[image-generation] Watermark crop failed, keeping image as-is:', err instanceof Error ? err.message : err);
    return { buffer, contentType };
  }
}

// One Pollinations request. Throws PollinationsError, flagged retryable or not.
async function fetchFromPollinations(url: URL, apiKey: string | null): Promise<{ buffer: Buffer; contentType: string }> {
  const timeoutMs = Number(process.env.POLLINATIONS_TIMEOUT_MS) || 60000;
  // Queued (see pollinationsQueue above) so the timeout clock starts when this request actually
  // begins, not while it's waiting its turn behind another one.
  const res: Response = await runPollinationsSerialized(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      return await fetch(url.toString(), { signal: controller.signal, headers });
    } catch (err: any) {
      throw new PollinationsError(
        err?.name === 'AbortError'
          ? `Image generation timed out after ${Math.round(timeoutMs / 1000)}s.`
          : `Failed to reach the image generation service: ${err?.message || err}`,
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403 || body.toLowerCase().includes('valid api key is required')) {
      const hint = apiKey
        ? ' (check that POLLINATIONS_API_KEY env var contains a valid key from https://enter.pollinations.ai/keys)'
        : ' (this endpoint now requires an API key - get one at https://enter.pollinations.ai and set POLLINATIONS_API_KEY)';
      throw new PollinationsError(`Image generation service returned ${res.status}${hint}: ${body.slice(0, 200)}`, false, !!apiKey);
    }
    if (res.status === 429) {
      throw new PollinationsError(`Image generation service returned 429 (rate limited - this is a free shared service): ${body.slice(0, 200)}`, true);
    }
    if (res.status === 402) {
      throw new PollinationsError(`Image generation service returned 402 (out of pollen credits for model ${url.searchParams.get('model') || getModel()} - top up at https://enter.pollinations.ai or choose a cheaper POLLINATIONS_MODEL): ${body.slice(0, 200)}`, false, !!apiKey);
    }
    throw new PollinationsError(`Image generation service returned ${res.status}: ${body.slice(0, 200)}`, res.status >= 500);
  }
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!looksLikeImage(buffer)) throw new PollinationsError('Image generation service returned an empty or invalid image.', true);
  return { buffer, contentType };
}

export async function generateBackground(req: GenerateBackgroundRequest): Promise<GenerateBackgroundResult> {
  const width = req.width || 1080;
  const height = req.height || 1920;

  if (!req.forceRegenerate) {
    const cachedBase64 = readImageCache(req.cacheKey);
    if (cachedBase64) {
      return { imageBase64: cachedBase64, contentType: 'image/jpeg', width, height, cached: true, source: 'pollinations' };
    }
  }

  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const apiKey = getApiKey();
  // Keyed models in the order to try: the main model, then the free fallbacks (skipping the main
  // model while it's in its refusal cooldown).
  const keyedModels = Date.now() < paidModelRefusedUntil && getFreeModels().length
    ? getFreeModels()
    : [getModel(), ...getFreeModels()];
  let modelIndex = 0;
  const keyedUrl = (model: string) => {
    // Keyed API: key goes in the Authorization header only (see fetchFromPollinations), never the URL.
    const u = new URL(`${GEN_IMAGE_BASE}/${encodeURIComponent(req.prompt)}`);
    u.searchParams.set('model', model);
    u.searchParams.set('width', String(width));
    u.searchParams.set('height', String(height));
    u.searchParams.set('seed', String(seed));
    return u;
  };
  let url: URL;
  if (apiKey) {
    url = keyedUrl(keyedModels[0]);
  } else {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn('[image-generation] POLLINATIONS_API_KEY is not set - using the legacy keyless endpoint, which only serves a low-quality SD1.5-class model with a watermark. Get a key at https://enter.pollinations.ai for verse-relevant backgrounds.');
    }
    url = buildLegacyUrl(req, width, height, seed);
  }

  let pollinationsError: unknown = null;
  let useKey = apiKey;
  for (let attempt = 0; attempt <= POLLINATIONS_RETRY_DELAYS_MS.length; attempt++) {
    try {
      let { buffer, contentType } = await fetchFromPollinations(url, useKey);
      if (!useKey) ({ buffer, contentType } = await cropLegacyWatermark(buffer, contentType));
      ({ buffer, contentType } = await fitToRequestedAspect(buffer, contentType, width, height));
      if (!req.skipCacheWrite) writeImageCache(req.cacheKey, buffer);
      return { imageBase64: buffer.toString('base64'), contentType, width, height, cached: false, source: 'pollinations' };
    } catch (err) {
      pollinationsError = err;
      // Out of credits for this model, or a free model that is gone/refusing: try the next keyed model.
      if (useKey && err instanceof PollinationsError && (err.accountProblem || !err.retryable) && modelIndex < keyedModels.length - 1) {
        if (keyedModels[modelIndex] === getModel() && err.accountProblem) paidModelRefusedUntil = Date.now() + PAID_MODEL_COOLDOWN_MS;
        modelIndex++;
        console.warn(`[image-generation] Model ${keyedModels[modelIndex - 1]} unavailable (${err.message.slice(0, 160)}); trying free model ${keyedModels[modelIndex]}.`);
        url = keyedUrl(keyedModels[modelIndex]);
        attempt--;
        continue;
      }
      if (useKey && err instanceof PollinationsError && err.accountProblem) {
        // Out of credits / bad key: switch to the keyless endpoint for the rest of this call's
        // attempts instead of giving up to an unrelated stock photo.
        console.warn(`[image-generation] Keyed Pollinations API refused the account (${err.message}); falling back to the keyless endpoint (lower quality, but generated from this verse's prompt).`);
        useKey = null;
        url = buildLegacyUrl(req, width, height, seed);
        attempt--;
        continue;
      }
      const retryable = !(err instanceof PollinationsError) || err.retryable;
      if (!retryable || attempt === POLLINATIONS_RETRY_DELAYS_MS.length) break;
      const delay = POLLINATIONS_RETRY_DELAYS_MS[attempt];
      console.warn(`[image-generation] Pollinations attempt ${attempt + 1} failed (${err instanceof Error ? err.message : err}); retrying in ${delay / 1000}s.`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // --- Hard-failure escape hatch ---
  // Pollinations is still failing after retries. Rather than blocking poster generation outright,
  // return an arbitrary Picsum photo marked source: 'stock' - NOT cached (so the next run for this
  // verse tries Pollinations again instead of silently reusing it), and flagged so the caller
  // (verse.routes.ts) prefers any real AI candidate over it and the client can say it was used.
  console.warn('[image-generation] Pollinations failed after retries; falling back to an unrelated Picsum stock photo. Pollinations error:', pollinationsError instanceof Error ? pollinationsError.message : pollinationsError);
  try {
    const { buffer, contentType } = await fetchPicsumFallback(req.cacheKey, width, height);
    return { imageBase64: buffer.toString('base64'), contentType, width, height, cached: false, source: 'stock' };
  } catch (picsumErr) {
    // Re-throw the ORIGINAL Pollinations error when even Picsum fails - that's the one the user
    // actually needs to debug, not the cascading fallback failure.
    console.error('[image-generation] Picsum fallback also failed:', picsumErr instanceof Error ? picsumErr.message : picsumErr);
    throw pollinationsError;
  }
}

// Lightweight reachability check for the UI's "image service" status indicator. Pollinations has
// no per-model availability concept the way a local ComfyUI install did (no checkpoint to be
// missing). The app also now has a Picsum photos hard-fallback (see generateBackground above),
// so even when Pollinations is auth-gated / down, the overall "image generation as a whole is
// functional" status should remain true - only a total network outage (both Pollinations and
// Picsum unreachable within the timeout) should report false.
export async function isImageServiceAvailable(): Promise<boolean> {
  const check = async (url: string, timeout = 4000): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, { signal: controller.signal, method: 'HEAD' }).catch(() =>
        fetch(url, { signal: controller.signal })
      );
      clearTimeout(timeoutId);
      // A 401 from Pollinations just means the caller needs an API key - the service is reachable.
      return res.status !== 0;
    } catch {
      return false;
    }
  };
  // Reachability = either the primary Pollinations endpoint OR the Picsum fallback is reachable
  // within the timeout window. Picsum is on Unsplash's worldwide CDN so it's the more reliable
  // "any image service at all" barometer; Pollinations tells us whether the verse-themed path works.
  const [pollinationsOk, picsumOk] = await Promise.all([
    check(getApiKey() ? GEN_MODELS_URL : LEGACY_MODELS_URL),
    check('https://picsum.photos/seed/rehoboth-healthcheck/200/200', 3000),
  ]);
  return pollinationsOk || picsumOk;
}
