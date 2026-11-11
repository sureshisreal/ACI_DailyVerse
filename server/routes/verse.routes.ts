import { Router } from 'express';
import { getDailyVerse } from '../services/verse.service';
import { analyzeVerseWithClaude, pickFigureFreeFallbackPrompt } from '../../ai/analyzer';
import { staticFallbackAnalysis } from '../../ai/schema';
import { generateMeditation, adjustMeditationLength } from '../../ai/meditation';
import { selectVersePortion } from '../../ai/versePortionSelector';
import { designPosters } from '../../ai/posterDesign';
import { generatePostCaptions } from '../../ai/postCaption';
import { generateYouTubeMetadata, SERIES_DISPLAY_NAMES } from '../../ai/youtubeMetadata';
import { reviewBackgroundComposition } from '../../ai/backgroundReview';
import {
  generateBackground,
  commitBackgroundToCache,
  isImageServiceAvailable,
  IMAGE_GENERATOR_VERSION
} from '../services/image-generation.service';
import { saveGeneration, getHistory, recordYoutubeUploadFor } from '../services/manifest.service';
import {
  getInstagramSyncStatus, runInstagramSyncNow, postLibraryVideoToInstagram, scheduleLibraryVideoForInstagram, cancelInstagramSchedule,
} from '../services/instagramSync.service';
import { isYoutubeUploadConfigured, uploadVideoToYoutube } from '../services/youtube.service';
import { isFacebookConfigured, sendLibraryVideoToFacebook } from '../services/facebook.service';
import { scheduleLibraryVideoEverywhere } from '../services/socialSchedule.service';
import { isInstagramConfigured } from '../services/instagram.service';
import { upcomingPostTime } from '../utils/postTime';
import { getWhatsAppQueue, scheduleWhatsApp, cancelWhatsApp, markWhatsAppPosted, whatsAppPosterCaption, WHATSAPP_CHANNEL_URL } from '../services/whatsapp.service';
import { listLibrary, uploadLibraryVideo, resolveLibraryAsset } from '../services/library.service';
import { sha256 } from '../utils/hash';
import { startAutorun, getAutorunStatus, receiveAutorunReport } from '../services/autorun.service';
import type { BibleThemeKey } from '../../ai/themeMapper';

export const verseRouter = Router();

const BACKGROUND_REVIEW_MAX_ATTEMPTS = 5;
// When images come from the free fallback models (Pollinations account out of pollen), retries rarely
// do better and each costs ~15s of generation plus a review - stop after this many and use the best
// candidate (or the figure-free fallback below).
const FREE_MODEL_REVIEW_MAX_ATTEMPTS = 2;

const BACKGROUND_RETRY_COMPOSITION_OVERRIDE = 'CRITICAL COMPOSITION OVERRIDE (RETRY ESCALATION): the entire subject is confined to a small tight group strictly within the BOTTOM 25% of the frame only. No head, hand, shoulder, building, tree, or tall silhouette crosses the 30% vertical line or above. The TOP 70% of the frame is COMPLETELY EMPTY — only plain open sky, soft blurred distant atmosphere, or smooth gradient. Negative constraint: no vertically-tall standing figure, no tower, no steeple, no object taller than 25% of frame height anywhere in the image. If a person is in the shot, the previous attempt failed because a full head-to-foot figure was merely positioned low instead of being cropped — fix this by re-framing the shot itself as a tight crop from the shoulders or waist down, with the head and face excluded from the frame entirely, rather than trying harder to position an uncropped figure.';

// Dynamic, not a static string like the vertical override above: verified directly against real
// generation logs that a generic "put it on the right" instruction, repeated verbatim on every
// retry, was not landing - 4 of 5 attempts for one verse placed the figure on the LEFT or in the
// CENTER anyway. Echoing back the reviewer's OWN actual explanation of what went wrong (the same
// pattern buildRelevanceRetryOverride below already uses for relevance/Christian-context failures)
// gives the model a concrete, specific correction instead of a repeated generic rule it's already
// demonstrated it can ignore.
function buildEditorialCompositionRetryOverride(lastReason: string): string {
  return `CRITICAL COMPOSITION OVERRIDE (RETRY ESCALATION): the previous attempt FAILED review for this exact reason: "${lastReason}". This is almost always because the subject was placed on the LEFT side or in the CENTER of the frame instead of the RIGHT side - correct that specifically now: the entire subject must sit strictly within the RIGHT 30% of the frame's width (the side nearer the right edge of the photograph, not the left, not the middle). The LEFT 60% of the frame's full height must be COMPLETELY EMPTY — only plain open sky, soft blurred distant atmosphere, or smooth gradient, nothing else. A compact human figure MAY be shown head-to-foot here (the head does not need to be cropped out) as long as the entire figure stays on the RIGHT side of that line. Do not center the subject and do not mirror it to the left - RIGHT SIDE ONLY, and describe it that way explicitly in the prompt rather than leaving the side implicit.`;
}

// Same dynamic pattern as buildEditorialCompositionRetryOverride above, built in from the start for
// 'corner' and 'centered' rather than discovered as a bug afterward the way the editorial one was.
function buildCornerCompositionRetryOverride(lastReason: string): string {
  return `CRITICAL COMPOSITION OVERRIDE (RETRY ESCALATION): the previous attempt FAILED review for this exact reason: "${lastReason}". Two different fixes may be needed depending on that reason: (1) if the subject was on the wrong side or spanning too much width, correct that: the one CONCRETE subject (a sharply-detailed person, animal, building, or object) must sit in a SMALL area strictly within the BOTTOM-RIGHT CORNER only - roughly the bottom 20% of height, right half of the width, not the left half, not centered, not spanning the full width. (2) if the previous attempt instead filled the whole frame with a sharp, detailed landscape (this is the more common failure) - that means the scene was rendered as an epic, texture-heavy vista instead of a calm backdrop; fix this by making the landscape/sky SOFT, HAZY, and LOW-DETAIL throughout (it may still fill the frame as atmosphere, that's fine and expected), and adding exactly ONE small, sharply-detailed concrete element (a tree, a distant figure, a rock, a gate) confined to the bottom-right corner as the sole focal point - the rest of the frame should read as calm backdrop, not competing detail. The BOTTOM-LEFT corner must stay free of any sharp concrete element, same as the top. Describe the corner placement AND the soft/hazy backdrop explicitly in the prompt rather than leaving either implicit.`;
}

function buildCenteredCompositionRetryOverride(lastReason: string): string {
  return `CRITICAL COMPOSITION OVERRIDE (RETRY ESCALATION): the previous attempt FAILED review for this exact reason: "${lastReason}". Correct that specifically now: the entire subject must sit strictly within the CENTER 30% of the frame's width, full height, with BOTH the left ~33% AND the right ~33% completely empty at once - not just one side. If the subject was drifting toward one edge, pull it back to true center; if only one flanking zone was actually clear, the other must be fixed too, since text needs to go on both sides simultaneously. A compact human figure may be shown head-to-foot here as long as it stays centered and upright. Do not let the subject favor either side - CENTERED, WITH BOTH FLANKS OPEN, described that way explicitly in the prompt.`;
}

const SAFETY_NEGATIVE_PROMPT = 'revealing clothing, low-cut neckline, cleavage, lingerie, swimwear, nudity, bare skin emphasis, seductive pose, glamour photography, fashion editorial, sexualized, suggestive';

const SAFE_FALLBACK_NEGATIVE_PROMPT = 'people, person, human figure, face, body, hands, animals, text, typography, watermark, logo, ' + SAFETY_NEGATIVE_PROMPT;

// Shared across both layouts (texture/lighting/depth/artifacts/color-grade quality bar) - only the
// final composition-specific sentence differs between subject-bottom and subject-right retries.
const PRO_QUALITY_RETRY_OVERRIDE_BODY = 'PROFESSIONAL QUALITY RETRY ESCALATION: the previous image failed the pro-quality photographic review. Apply these mandatory fixes: (1) Primary subject surfaces must have TANGIBLE, FEEL-able texture — rough stone grain, weathered wood cracks, linen weave, bread crust crumbs, wool fiber, leather creases, bark ridges; absolutely no smooth, uniform, plasticky, waxy, or CGI-perfect surfaces. (2) Use a single clear, believable light direction (golden-hour side light, chiaroscuro window light, soft overcast diffuse light, warm rim light) — no flat even box lighting, no uncanny AI-generated light rays, no blown pure-white clipped highlights or crushed pure-black shadows with zero detail. (3) Ensure real 3D depth via atmospheric haze, salt mist, dust motes, or progressively softer distant detail and near/mid/far focus falloff; NOT flat same-plane all-equally-sharp rendering. (4) ZERO visible AI artifacts: no fused or missing or extra fingers, no distorted anatomy, no floating shadowless objects, no repeating tiled stone or wood textures, no unnatural blur patches, no letter or number shapes embedded in grain, no symmetric mirroring, no generic glowing cross clichés. (5) Color grade must be natural and film-like (Kodak Portra 400 / Ektar 100 earth tones) — no oversaturated neon colors, no washed-out shifts, no HDR halos, no gradient banding in skies, no clipped blank-white skies.';

const PRO_QUALITY_RETRY_OVERRIDE = `${PRO_QUALITY_RETRY_OVERRIDE_BODY} Keep the subject STRICTLY below the 45% vertical line. If a person is present, the shot must be framed from chest, shoulders, or waist down only, with the head and face entirely excluded from the frame.`;

const PRO_QUALITY_RETRY_OVERRIDE_EDITORIAL = `${PRO_QUALITY_RETRY_OVERRIDE_BODY} Keep the subject STRICTLY within the RIGHT 30% of the frame's width - not the left, not the center. A compact human figure may be shown head-to-foot here as long as the entire figure stays on the right side of that line.`;

const PRO_QUALITY_RETRY_OVERRIDE_CORNER = `${PRO_QUALITY_RETRY_OVERRIDE_BODY} Keep the subject STRICTLY within a small bottom-right corner area - not spanning the full bottom width, not bottom-left, not centered.`;

const PRO_QUALITY_RETRY_OVERRIDE_CENTERED = `${PRO_QUALITY_RETRY_OVERRIDE_BODY} Keep the subject STRICTLY within the center 30% of the frame's width, with both the left third and the right third completely open at once.`;

function buildRelevanceRetryOverride(visualConcept: string, rejectionReasons: string[], useSimplifiedGesture: boolean): string {
  const gestureFallback = useSimplifiedGesture
    ? ' If the exact pose described is proving difficult to render clearly, a simpler but still unmistakably Christian alternative is acceptable instead - e.g. a person or family kneeling with hands folded in prayer, head bowed, or seated together with an open Bible - as long as the setting and subject stay true to the concept above.'
    : '';
  return `CRITICAL SUBJECT OVERRIDE (RETRY ESCALATION): the previous image did not pass review (reviewer noted: "${rejectionReasons.join('; ')}"). The image MUST clearly and unmistakably depict exactly this: ${visualConcept}. This scene must be unmistakably Christian in character (a person or family in prayer/worship/fellowship, a biblical-era setting, or a church/community scene - whichever the concept above specifies) - do not substitute a generic religious scene, an unrelated figure, an anonymous unmarked person, or plain scenery. The specific subject and action described above must be the obvious focus of the photo.${gestureFallback}`;
}

type PosterLayoutFull = 'vertical' | 'editorial' | 'corner' | 'centered';

// Composition-retry override per layout - 'vertical' is the one static string (no left/right
// ambiguity, never needed the dynamic treatment); the other three all have a directional risk and
// get the dynamic, reason-echoing override (see each build*CompositionRetryOverride above).
function buildCompositionRetryOverride(layout: PosterLayoutFull, lastReason: string): string {
  if (layout === 'editorial') return buildEditorialCompositionRetryOverride(lastReason);
  if (layout === 'corner') return buildCornerCompositionRetryOverride(lastReason);
  if (layout === 'centered') return buildCenteredCompositionRetryOverride(lastReason);
  return BACKGROUND_RETRY_COMPOSITION_OVERRIDE;
}

function proQualityRetryOverrideFor(layout: PosterLayoutFull): string {
  if (layout === 'editorial') return PRO_QUALITY_RETRY_OVERRIDE_EDITORIAL;
  if (layout === 'corner') return PRO_QUALITY_RETRY_OVERRIDE_CORNER;
  if (layout === 'centered') return PRO_QUALITY_RETRY_OVERRIDE_CENTERED;
  return PRO_QUALITY_RETRY_OVERRIDE;
}

async function generateReviewedBackground(
  prompt: string,
  negativePrompt: string | undefined,
  baseCacheKey: string,
  theme?: string,
  visualConcept?: string,
  themeKey?: BibleThemeKey,
  forceRegenerate?: boolean,
  layout: PosterLayoutFull = 'vertical',
  width: number = 720,
  height: number = 1280
) {
  type Background = Awaited<ReturnType<typeof generateBackground>>;
  let lastReview: Awaited<ReturnType<typeof reviewBackgroundComposition>> | null = null;
  let relevanceOrChristianFailCount = 0;
  // Best-scoring AI (Pollinations) candidate that didn't fully pass review - still preferred over a
  // stock photo, which has no relation to the verse at all (see generateBackground's source).
  let bestBackground: Background | null = null;
  let bestReview: Awaited<ReturnType<typeof reviewBackgroundComposition>> | null = null;
  let bestScore = -1;
  let stockBackground: Background | null = null;
  const safeNegativePrompt = [negativePrompt, SAFETY_NEGATIVE_PROMPT].filter(Boolean).join(', ');
  for (let attempt = 0; attempt < BACKGROUND_REVIEW_MAX_ATTEMPTS; attempt++) {
    const cacheKey = attempt === 0 ? baseCacheKey : `${baseCacheKey}-retry-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let attemptPrompt = prompt;
    if (attempt > 0 && lastReview) {
      const overrides: string[] = [];
      if (!lastReview.suitable) overrides.push(buildCompositionRetryOverride(layout, lastReview.reason));
      if (!lastReview.proQuality) overrides.push(proQualityRetryOverrideFor(layout));
      if ((!lastReview.relevant || !lastReview.christian) && visualConcept) {
        const reasons = [!lastReview.relevant && lastReview.relevanceReason, !lastReview.christian && lastReview.christianReason].filter(Boolean) as string[];
        relevanceOrChristianFailCount++;
        overrides.push(buildRelevanceRetryOverride(visualConcept, reasons, relevanceOrChristianFailCount >= 2));
      }
      // Corrections go FIRST: image models weight the start of the prompt most, so appending them
      // after a long prompt (as before) let the same mistake repeat on every retry.
      attemptPrompt = [...overrides, prompt].join(' ');
    }
    const background = await generateBackground({
      prompt: attemptPrompt,
      negativePrompt: safeNegativePrompt,
      width,
      height,
      cacheKey,
      skipCacheWrite: true,
      forceRegenerate
    });

    if (background.cached) return background;

    // Pollinations is down even after generateBackground's own retries - further attempts would
    // hit the same outage, and reviewing an unrelated stock photo just spends a vision call to
    // reject it. Stop here and choose below.
    if (background.source === 'stock') {
      stockBackground = background;
      console.warn(`Background: image service unavailable on attempt ${attempt + 1}/${BACKGROUND_REVIEW_MAX_ATTEMPTS}; stopping review loop.`);
      break;
    }

    const review = await reviewBackgroundComposition(
      background.imageBase64,
      background.contentType === 'image/png' ? 'image/png' : 'image/jpeg',
      theme,
      visualConcept,
      layout
    );
    lastReview = review;
    if (review.suitable && review.relevant && review.christian && review.proQuality) {
      commitBackgroundToCache(baseCacheKey, background.imageBase64);
      return background;
    }
    const score = (review.suitable ? 2 : 0) + (review.relevant ? 1 : 0) + (review.christian ? 1 : 0) + (review.proQuality ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestBackground = background;
      bestReview = review;
    }
    const failedChecks = [
      !review.suitable && `composition: ${review.reason}`,
      !review.relevant && `relevance: ${review.relevanceReason}`,
      !review.christian && `christian-context: ${review.christianReason}`,
      !review.proQuality && `pro-quality: ${review.qualityReason}`,
    ].filter(Boolean).join(' | ');
    console.warn(`Background rejected by review (attempt ${attempt + 1}/${BACKGROUND_REVIEW_MAX_ATTEMPTS}): ${failedChecks}`);
    if (background.freeModel && attempt + 1 >= FREE_MODEL_REVIEW_MAX_ATTEMPTS) {
      console.warn(`Background: free fallback image model in use; stopping after ${attempt + 1} attempts.`);
      break;
    }
  }

  // No AI candidate carried a Christian marker: try a theme-aligned figure-free scene instead -
  // but only when the image service is actually up (stockBackground unset), and only accept it if
  // it's a real AI image that passes the composition/quality review. It used to be committed
  // unreviewed, so an outage at this step shipped an arbitrary stock photo as the verse's image.
  if (!stockBackground && (!bestReview || !bestReview.christian)) {
    const themeSafeFallbackPrompt = pickFigureFreeFallbackPrompt(themeKey);
    console.warn(
      `Background: no attempt passed Christian-context review after ${BACKGROUND_REVIEW_MAX_ATTEMPTS} attempts; trying theme-aligned figure-free background (themeKey=${themeKey || 'GENERIC'}).`
    );
    try {
      // Note: pickFigureFreeFallbackPrompt's 20 theme prompts are written for the vertical
      // (subject-bottom) layout only - this terminal fallback is rare enough (every review attempt
      // exhausted) that reusing them for editorial requests too is an acceptable degrade rather
      // than writing a full parallel set; a figure-free scene still lands reasonably via the
      // renderer's own left-column search even when composed for the wrong axis.
      const safeBackground = await generateBackground({
        prompt: themeSafeFallbackPrompt,
        negativePrompt: SAFE_FALLBACK_NEGATIVE_PROMPT,
        width,
        height,
        cacheKey: `${baseCacheKey}-safe-fallback`,
        skipCacheWrite: true
      });
      if (safeBackground.source === 'stock') {
        stockBackground = safeBackground;
      } else {
        // A figure-free scene can't carry the people-based Christian markers the review asks for,
        // so only composition and quality gate it here.
        const safeReview = await reviewBackgroundComposition(
          safeBackground.imageBase64,
          safeBackground.contentType === 'image/png' ? 'image/png' : 'image/jpeg',
          theme,
          visualConcept,
          layout
        );
        if (safeReview.suitable && safeReview.proQuality) {
          commitBackgroundToCache(baseCacheKey, safeBackground.imageBase64);
          return safeBackground;
        }
        console.warn(`Background: figure-free fallback also rejected (composition: ${safeReview.reason} | pro-quality: ${safeReview.qualityReason}).`);
      }
    } catch (safeErr) {
      console.error('Safe fallback background generation also failed:', safeErr instanceof Error ? safeErr.message : safeErr);
    }
  }

  // Best real AI candidate beats a stock photo even when it didn't fully pass review.
  if (bestBackground) {
    commitBackgroundToCache(baseCacheKey, bestBackground.imageBase64);
    return bestBackground;
  }
  if (stockBackground) {
    // Deliberately not cached - the next run for this verse retries Pollinations.
    console.warn('Background: returning an unrelated stock photo (image service unavailable); the client is told via imageSource.');
    return stockBackground;
  }
  throw new Error('Background image generation failed: no image could be produced.');
}

// Step 1: resolve the exact English/Tamil/Telugu verse from SQLite. No AI involved - instant,
// and the single entry point the rest of the app uses for Scripture (see verse.service.ts).
verseRouter.post('/verse/lookup', (req, res) => {
  const { reference } = req.body as { reference?: string };
  if (!reference || !reference.trim()) {
    return res.status(400).json({ error: 'Bible reference is required.' });
  }
  const verse = getDailyVerse(reference.trim());
  if (!verse.english && !verse.tamil && !verse.telugu) {
    return res.status(404).json({
      error: `"${reference}" wasn't found in the local Bible database. Check the reference format (e.g. "John 3:16" or "Philippians 4:6-7").`
    });
  }
  res.json(verse);
});

// Step 2: Claude analysis (cached) -> ONE background image via Pollinations.ai (cached), reused
// for both bilingual posters. Never generates or substitutes Scripture - only interpretive fields
// for the image prompt and the poster's font/color styling.
verseRouter.post('/verse/analyze', async (req, res) => {
  const { reference, english, tamil, telugu, forceRegenerate } = req.body as {
    reference?: string;
    english?: string;
    tamil?: string;
    telugu?: string;
    // "Regenerate image" action (DailyVerseGenerator.tsx) - same verse, same Claude analysis
    // (cached, so the theme/concept/color-grade assignment stays consistent for this verse), but
    // skips the image cache so a brand new Pollinations photo is generated instead of returning
    // the one already on disk for this verse.
    forceRegenerate?: boolean;
  };
  if (!reference || !english) {
    return res.status(400).json({ error: 'reference and english verse text are required.' });
  }

  let analysis;
  try {
    analysis = await analyzeVerseWithClaude(reference, english, tamil || '', telugu || '');
  } catch (err: any) {
    console.warn('Claude analysis unavailable, using static fallback:', err?.message || err);
    analysis = staticFallbackAnalysis(english, tamil || '', telugu || '');
  }

  const cacheKey = sha256([reference, english, tamil || '', telugu || '', analysis.prompt, analysis.negativePrompt, String(IMAGE_GENERATOR_VERSION)].join('|'));

  try {
    // Generated at 720x1280 (same 9:16 ratio as the final 1080x1920 poster, ~44% of the pixel
    // count) rather than the poster's full canonical resolution - keeps the request lighter, and
    // Pollinations doesn't guarantee it honors exact dimensions anyway. The client canvas-upscales
    // the result to exactly 1080x1920 before compositing posters and saving output, so poster
    // quality/size is unaffected.
    const background = await generateReviewedBackground(analysis.prompt, analysis.negativePrompt, cacheKey, analysis.theme, analysis.visualConcept, analysis.themeKey, forceRegenerate);
    return res.json({
      analysis,
      backgroundImageBase64: background.imageBase64,
      contentType: background.contentType,
      cached: background.cached,
      // 'stock': an unrelated Picsum photo used only because the image service was down - the
      // client shows a notice suggesting "Regenerate image".
      imageSource: background.source
    });
  } catch (err: any) {
    console.error('Background image generation failed:', err?.message || err);
    return res.status(502).json({ error: err?.message || 'Background image generation failed. Please try again.', analysis });
  }
});

// NOTE: Poster, Video, and Meditation all share the ONE background /verse/analyze above produces
// (see components/DailyVerseGenerator.tsx) - there used to be a second '/verse/analyze-poster'
// route here generating a separate 4:5 background specifically composed for the Poster's own
// editorial/corner/centered layout (subject confined to a right column / corner / center column).
// Removed per explicit request to use the same image across all three outputs instead of paying for
// a second Claude+Pollinations call whenever Poster was combined with Video/Meditation. The
// editorial/corner/centered RENDER functions (components/posterRenderer.ts) and their theme->layout
// picker (ai/themeMapper.ts's pickPosterLayoutForTheme) are still used - the client still picks one
// of the three text layouts per verse theme, it just paints that layout onto the shared vertical
// background's own cover-fit crop instead of a purpose-generated one. The underlying
// editorial/corner/centered PROMPT/composition-review machinery in ai/analyzer.ts, ai/themeMapper.ts,
// and ai/backgroundReview.ts is now unreachable (nothing calls analyzeVerseWithClaude or
// generateReviewedBackground with a non-'vertical' layout anymore) but left in place rather than
// deleted, in case this direction is revisited.

// Claude-designed poster layout/typography variants for the background the client already has
// (see ai/posterDesign.ts). Never fails the request: an empty list just means "automatic layout
// only", which the client always offers anyway.
verseRouter.post('/verse/poster-designs', async (req, res) => {
  const { backgroundImageBase64, reference, english, tamil, telugu, theme, emotion, accentColor } = req.body as {
    backgroundImageBase64?: string; reference?: string; english?: string; tamil?: string; telugu?: string;
    theme?: string; emotion?: string; accentColor?: string;
  };
  if (!backgroundImageBase64 || !reference || !english) {
    return res.status(400).json({ error: 'backgroundImageBase64, reference and english are required.' });
  }
  const designs = await designPosters({
    backgroundImageBase64, reference, english, tamil: tamil || '', telugu: telugu || '', theme, emotion, accentColor,
  });
  res.json({ designs });
});

// Ready-to-paste captions for posting the posters on the channel's Posts tab (see
// ai/postCaption.ts) - the YouTube API can't create community posts, so posting stays manual.
// Never fails: plain verse-only captions are returned when Claude is unavailable.
verseRouter.post('/verse/post-captions', async (req, res) => {
  const { reference, english, tamil, telugu, tamilReference, teluguReference, viewerSituation, emotionalHook } = req.body as {
    reference?: string; english?: string; tamil?: string; telugu?: string;
    tamilReference?: string; teluguReference?: string; viewerSituation?: string; emotionalHook?: string;
  };
  if (!reference || !english || !tamil || !telugu) {
    return res.status(400).json({ error: 'reference, english, tamil and telugu are required.' });
  }
  const captions = await generatePostCaptions({
    reference, english, tamil, telugu,
    tamilReference: tamilReference || reference, teluguReference: teluguReference || reference,
    viewerSituation, emotionalHook,
  });
  res.json({ captions });
});

// How much of the verse the poster shows (see ai/versePortionSelector.ts): Claude decides whether
// a shorter, complete, meaning-preserving thought exists in all three languages at once, or the
// full verse is used. Deliberately no error response here - selectVersePortion never throws, it
// resolves to the full verse on any internal failure, since that's always a valid answer and
// poster generation must never block on this call being reachable.
verseRouter.post('/verse/portion', async (req, res) => {
  const { reference, english, tamil, telugu } = req.body as {
    reference?: string;
    english?: string;
    tamil?: string;
    telugu?: string;
  };
  if (!reference || !english || !tamil || !telugu) {
    return res.status(400).json({ error: 'reference and all three verse texts are required.' });
  }
  const portion = await selectVersePortion(reference, english, tamil, telugu);
  res.json({ portion });
});

// Devotional meditation (explanation + prayer, in all three languages) for one verse - see
// ai/meditation.ts for the tone constraints. Distinct from /verse/analyze: this never touches the
// background image or poster styling, only the meditation text used for the narrated meditation
// video. No static fallback (unlike analyze) - generic placeholder devotional prose would defeat
// the point of the feature, so a Claude failure here is a real error, not a silent degrade.
verseRouter.post('/verse/meditation', async (req, res) => {
  const { reference, english, tamil, telugu } = req.body as {
    reference?: string;
    english?: string;
    tamil?: string;
    telugu?: string;
  };
  if (!reference || !english || !tamil || !telugu) {
    return res.status(400).json({ error: 'reference and all three verse texts are required.' });
  }

  try {
    const meditation = await generateMeditation(reference, english, tamil, telugu);
    res.json({ meditation });
  } catch (err: any) {
    console.error('Meditation generation failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'Meditation generation failed. Please try again.' });
  }
});

// Rewrites one language's meditation explanation+prayer toward a target word count - the
// Meditation Video's runtime-enforcement step (see runMeditationGeneration in
// DailyVerseGenerator.tsx, which measures the actual synthesized audio duration and calls this when
// the total falls outside its 120-180s target). Not cached: this is a one-off correction against a
// specific prior attempt's measured duration, not a stable per-verse result.
verseRouter.post('/verse/meditation/adjust', async (req, res) => {
  const { reference, verseText, lang, priorExplanation, priorPrayer, targetTotalWords } = req.body as {
    reference?: string;
    verseText?: string;
    lang?: 'en' | 'ta' | 'te';
    priorExplanation?: string;
    priorPrayer?: string;
    targetTotalWords?: number;
  };
  if (!reference || !verseText || !lang || !priorExplanation || !priorPrayer || !targetTotalWords) {
    return res.status(400).json({ error: 'reference, verseText, lang, priorExplanation, priorPrayer and targetTotalWords are required.' });
  }

  try {
    const meditation = await adjustMeditationLength(reference, verseText, lang, priorExplanation, priorPrayer, targetTotalWords);
    res.json({ meditation });
  } catch (err: any) {
    console.error('Meditation length adjustment failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'Meditation length adjustment failed.' });
  }
});

// YouTube upload metadata (title/thumbnail text/description/series) for one verse's video in one
// language - see ai/youtubeMetadata.ts. Only meaningful once a Video or Meditation is actually being
// generated for that language; a poster-only generation has no video to attach this to.
verseRouter.post('/verse/youtube-metadata', async (req, res) => {
  const { reference, verseText, lang, viewerSituation, emotionalHook, canonicalReference } = req.body as {
    reference?: string;
    verseText?: string;
    lang?: 'en' | 'ta' | 'te';
    viewerSituation?: string;
    emotionalHook?: string;
    canonicalReference?: string;
  };
  if (!reference || !verseText || !lang || !viewerSituation || !emotionalHook || !canonicalReference) {
    return res.status(400).json({ error: 'reference, verseText, lang, viewerSituation, emotionalHook and canonicalReference are required.' });
  }

  try {
    const metadata = await generateYouTubeMetadata(reference, verseText, lang, viewerSituation, emotionalHook, canonicalReference);
    // Resolved here (not left to the client) since SERIES_DISPLAY_NAMES is a fixed, non-AI-generated
    // lookup table that belongs with the rest of this module's server-only code, not duplicated
    // into client bundles.
    const seriesLabel = SERIES_DISPLAY_NAMES[metadata.seriesKey][lang];
    res.json({ metadata, seriesLabel });
  } catch (err: any) {
    console.error('YouTube metadata generation failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'YouTube metadata generation failed.' });
  }
});

// Poster assets (background+2 posters) are still all-or-nothing when provided together (the normal
// poster-save path), but the whole trio, plus videos/meditations, are otherwise independently
// optional - a video/meditation-only call (Poster unchecked, or one that finishes well after the
// poster's own save already ran) merges into the same manifest.json rather than needing everything
// at once. See saveGeneration's merge behavior in manifest.service.ts.
verseRouter.post('/verse/save', (req, res) => {
  const { date, reference, verses, analysis, backgroundImageBase64, tamilEnglishPosterBase64, teluguEnglishPosterBase64, videos, meditations, videoErrors, meditationErrors } = req.body;
  if (!date || !reference || !verses || !analysis) {
    return res.status(400).json({ error: 'date, reference, verses and analysis are required.' });
  }
  const posterFieldCount = [backgroundImageBase64, tamilEnglishPosterBase64, teluguEnglishPosterBase64].filter(Boolean).length;
  if (posterFieldCount > 0 && posterFieldCount < 3) {
    return res.status(400).json({ error: 'backgroundImageBase64, tamilEnglishPosterBase64 and teluguEnglishPosterBase64 must be provided together.' });
  }
  if (posterFieldCount === 0 && !videos && !meditations) {
    return res.status(400).json({ error: 'Provide poster assets and/or videos/meditations to save.' });
  }

  try {
    const { outputDir, manifest } = saveGeneration({ date, reference, verses, analysis, backgroundImageBase64, tamilEnglishPosterBase64, teluguEnglishPosterBase64, videos, meditations, videoErrors, meditationErrors });
    res.json({ success: true, outputDir, manifest });
  } catch (err: any) {
    console.error('Failed to save generation:', err?.message || err);
    res.status(500).json({ error: 'Failed to save generated assets to disk.' });
  }
});

verseRouter.get('/history', (_req, res) => {
  res.json({ history: getHistory() });
});

// Image-generation service reachability, for the "Image service ● Connected / ○ Offline" status
// shown before the user hits Generate.
verseRouter.get('/image-service/status', async (_req, res) => {
  const available = await isImageServiceAvailable();
  res.json({ available });
});

// Whether YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN are set (see scripts/youtube_authorize.ts's
// one-time setup) - the UI uses this to show/hide the "Upload to YouTube" action instead of letting
// every upload attempt fail with a config error.
// Everything previous runs left in output/ (see server/services/library.service.ts) - the backlog
// of already-rendered videos that no other upload path in this app can reach.
verseRouter.get('/library', (_req, res) => {
  try {
    res.json({ entries: listLibrary() });
  } catch (err: any) {
    console.error('Library listing failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Could not read the output library.' });
  }
});

// Serves one poster (or video) straight from the output tree, so the library can show real poster
// previews rather than just filenames. Restricted to the same recognised filenames the listing uses.
verseRouter.get('/library/file', (req, res) => {
  const { dir, file } = req.query as { dir?: string; file?: string };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });

  try {
    const { absPath, contentType } = resolveLibraryAsset(dir, file);
    res.type(contentType);
    res.sendFile(absPath);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Not found.' });
  }
});

// Publishes one file from that backlog. One video per request, deliberately: each one regenerates
// its title through Claude and pushes a multi-megabyte upload, so the client drives the batch and
// can show progress per video rather than blocking on a single request that uploads ninety.
verseRouter.post('/library/upload', async (req, res) => {
  const { dir, file } = req.body as { dir?: string; file?: string };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  if (!isYoutubeUploadConfigured()) {
    return res.status(503).json({ error: 'YouTube upload is not configured (run scripts/youtube_authorize.ts and set the resulting keys in .env).' });
  }

  try {
    res.json(await uploadLibraryVideo(dir, file));
  } catch (err: any) {
    console.error('Library upload failed:', err?.message || err);
    // `fatal` tells the client that every remaining upload in a bulk run would fail the same way
    // (quota exhausted, authorization dead) so it can stop immediately instead of working through
    // the rest of the backlog - see classifyUploadError in library.service.ts.
    res.status(502).json({ error: err?.message || 'Library upload failed.', fatal: Boolean(err?.fatal), reason: err?.reason });
  }
});

verseRouter.get('/youtube/status', (_req, res) => {
  res.json({ configured: isYoutubeUploadConfigured() });
});

// Uploads one already-generated video straight to the channel's YouTube account via the Data API
// (see server/services/youtube.service.ts) - title/description/tags come from the same
// generateYouTubeMetadata output already shown in the UI, so this is "publish what you're already
// looking at," not a second content-generation step.
verseRouter.post('/youtube/upload', async (req, res) => {
  const { videoBase64, title, description, tags, privacyStatus, thumbnailBase64, playlistTitle, output } = req.body as {
    videoBase64?: string;
    title?: string;
    description?: string;
    tags?: string[];
    privacyStatus?: 'private' | 'unlisted' | 'public';
    thumbnailBase64?: string;
    playlistTitle?: string;
    output?: { date?: string; reference?: string; file?: string };
  };
  if (!videoBase64 || !title || !description) {
    return res.status(400).json({ error: 'videoBase64, title and description are required.' });
  }
  if (!isYoutubeUploadConfigured()) {
    return res.status(503).json({ error: 'YouTube upload is not configured (run scripts/youtube_authorize.ts and set the resulting keys in .env).' });
  }

  try {
    const videoBuffer = Buffer.from(videoBase64.startsWith('data:') ? videoBase64.replace(/^data:[^,]+,/, '') : videoBase64, 'base64');
    const thumbnailBuffer = thumbnailBase64
      ? Buffer.from(thumbnailBase64.startsWith('data:') ? thumbnailBase64.replace(/^data:[^,]+,/, '') : thumbnailBase64, 'base64')
      : undefined;

    // A private upload follows the generator's date: YouTube makes it public at that day's
    // SOCIAL_POST_TIME, and Instagram + Facebook are scheduled for the same moment below.
    const goLive = privacyStatus === 'private' && output?.date ? upcomingPostTime(output.date) : null;
    const result = await uploadVideoToYoutube({
      videoBuffer, title, description, tags, privacyStatus, thumbnailBuffer, playlistTitle, publishAt: goLive ?? undefined,
    });
    const publishAt = goLive?.toISOString();
    if (output?.date && output.reference && output.file) {
      const dir = recordYoutubeUploadFor(output.date, output.reference, output.file, { videoId: result.videoId, url: result.videoUrl, publishAt });
      if (dir && publishAt) {
        // In the background - the Facebook upload can take a while and the YouTube one is done.
        if (isInstagramConfigured()) {
          try { scheduleLibraryVideoForInstagram(dir, output.file, publishAt); } catch (err: any) { console.warn('[schedule] Instagram:', err?.message || err); }
        }
        if (isFacebookConfigured()) {
          sendLibraryVideoToFacebook(dir, output.file, publishAt).catch((err) => console.warn('[schedule] Facebook:', err?.message || err));
        }
      }
    }
    res.json({ ...result, publishAt });
  } catch (err: any) {
    console.error('YouTube upload failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'YouTube upload failed.' });
  }
});

// YouTube -> Instagram auto-posting (see server/services/instagramSync.service.ts): status for the
// UI, and a manual "check now" instead of waiting for the next scheduled pass.
verseRouter.get('/instagram/status', (_req, res) => {
  res.json(getInstagramSyncStatus());
});

// Posts one library video to Instagram as a Reel right away (the library's "Instagram" button).
verseRouter.post('/library/instagram', async (req, res) => {
  const { dir, file } = req.body as { dir?: string; file?: string };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    const posted = await postLibraryVideoToInstagram(dir, file);
    res.json({ mediaId: posted.mediaId, permalink: posted.permalink, postedAt: posted.postedAt });
  } catch (err: any) {
    console.error('Instagram post failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'Instagram post failed.' });
  }
});

// Schedules (at = ISO time) or cancels (at = null) a library video's Instagram post.
verseRouter.post('/library/instagram/schedule', (req, res) => {
  const { dir, file, at } = req.body as { dir?: string; file?: string; at?: string | null };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    if (at) res.json(scheduleLibraryVideoForInstagram(dir, file, at));
    else {
      cancelInstagramSchedule(dir, file);
      res.json({ cancelled: true });
    }
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not schedule the Instagram post.' });
  }
});

verseRouter.get('/facebook/status', (_req, res) => {
  res.json({ configured: isFacebookConfigured() });
});

// Uploads one library video to the Facebook Page, never public straight away: an unpublished draft
// (at = null) or natively scheduled by Facebook for `at` (ISO time). See facebook.service.ts.
verseRouter.post('/library/facebook', async (req, res) => {
  const { dir, file, at } = req.body as { dir?: string; file?: string; at?: string | null };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    res.json(await sendLibraryVideoToFacebook(dir, file, at || null));
  } catch (err: any) {
    console.error('Facebook upload failed:', err?.message || err);
    res.status(502).json({ error: err?.message || 'Facebook upload failed.' });
  }
});

// Schedules one library video on YouTube, Instagram and Facebook for the same go-live time: its
// verse date at SOCIAL_POST_TIME, or `at` (ISO) to override. Past dates stay unpublished on every
// channel. Per-channel outcomes come back - one channel failing doesn't stop the others.
verseRouter.post('/library/schedule-all', async (req, res) => {
  const { dir, file, at } = req.body as { dir?: string; file?: string; at?: string | null };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    res.json(await scheduleLibraryVideoEverywhere(dir, file, at || null));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not schedule.' });
  }
});

// WhatsApp Channel queue (see whatsapp.service.ts): posters scheduled per verse date, posted by hand
// from the app once due since WhatsApp has no Channel posting API.
verseRouter.get('/whatsapp/queue', async (_req, res) => {
  try {
    res.json(await getWhatsAppQueue());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Could not load the WhatsApp queue.' });
  }
});

// Schedules a verse's posters for `at` (ISO) or its own date (no `at`); `cancel: true` removes it.
// `scheduled: null` in the reply means the date has passed and nothing was scheduled.
verseRouter.post('/library/whatsapp/schedule', (req, res) => {
  const { dir, at, cancel } = req.body as { dir?: string; at?: string | null; cancel?: boolean };
  if (!dir) return res.status(400).json({ error: 'dir is required.' });
  try {
    if (cancel) {
      cancelWhatsApp(dir);
      return res.json({ cancelled: true });
    }
    res.json({ scheduled: scheduleWhatsApp(dir, at || null) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not schedule the WhatsApp post.' });
  }
});

verseRouter.get('/library/whatsapp/caption', async (req, res) => {
  const { dir, file } = req.query as { dir?: string; file?: string };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    res.json({ caption: await whatsAppPosterCaption(dir, file), channelUrl: WHATSAPP_CHANNEL_URL });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not write the caption.' });
  }
});

verseRouter.post('/library/whatsapp/posted', (req, res) => {
  const { dir, file, posted } = req.body as { dir?: string; file?: string; posted?: boolean };
  if (!dir || !file) return res.status(400).json({ error: 'dir and file are required.' });
  try {
    markWhatsAppPosted(dir, file, posted !== false);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not update.' });
  }
});

verseRouter.post('/instagram/sync', async (_req, res) => {
  try {
    res.json(await runInstagramSyncNow());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Instagram sync failed.' });
  }
});

// --- Automatic daily run (see services/autorun.service.ts) ---
// POST /api/autorun/start {date?, force?, wait?}: generate (if needed) and schedule a plan date,
// tomorrow by default. With wait=true the response is the finished run record (kept alive by
// keepAliveJson while it runs) - that's how scripts/autorun.sh reports the result to the GitHub Action.
verseRouter.post('/autorun/start', async (req, res) => {
  const { date, force, wait, dryRun } = req.body as { date?: string; force?: boolean; wait?: boolean; dryRun?: boolean };
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const run = startAutorun({ date, force: !!force, dryRun: !!dryRun, port: Number(process.env.PORT) || 3000 });
  if (!wait) return res.json({ started: true, status: getAutorunStatus().running });
  res.json(await run);
});

verseRouter.get('/autorun/status', (_req, res) => {
  res.json(getAutorunStatus());
});

// The headless page's report that its generation finished (see DailyVerseGenerator's autorun mode).
verseRouter.post('/autorun/report', (req, res) => {
  const { date, ok, error, videos, posters } = req.body || {};
  if (typeof date !== 'string') return res.status(400).json({ error: 'date is required' });
  res.json({ accepted: receiveAutorunReport({ date, ok: !!ok, error, videos, posters }) });
});
