import type { BibleThemeKey } from './ai/themeMapper';

// Poster typeface pairing, chosen per-verse (see ai/analyzer.ts + ai/themeMapper.ts) from this
// fixed set - never a freeform font name, since an unloaded/invalid family would silently fall
// back to a system font. See components/posterRenderer.ts's FONT_STYLE_PRESETS for what each key
// renders as.
export type FontStyleKey = 'classic-serif' | 'delicate-serif' | 'engraved-display' | 'decorative-warm';

// Per-verse analysis output. The Scripture text on the poster always comes from the Bible DB,
// never from this analysis - these are interpretive fields the image/render pipeline uses to
// produce a verse-grounded background, typography, and narration. See ai/schema.ts for the
// version const and validator.
export interface VerseAnalysis {
  // Standardized Bible theme key produced by ai/themeMapper.ts's deterministic keyword classifier.
  // Fallback for a verse where no keywords matched: "GENERIC".
  themeKey: BibleThemeKey;
  // Human-readable theme label (e.g. "Divine Protection", "God's Provision") - matches themeKey.
  theme: string;
  emotion: string;
  // The everyday human situation this verse actually speaks to (e.g. "someone facing an uncertain
  // decision with no clear answer"), grounding the image concept below and any narration/hook
  // content that needs to connect Scripture to real life - never Scripture itself, never invented
  // theology, just an honest read of who this verse is for.
  viewerSituation: string;
  // A short (one sentence, spoken-naturally) line inviting that viewer in, grounded in
  // viewerSituation - e.g. "If you're afraid today, listen to this." Truthful to the verse's actual
  // content, never a manipulative/clickbait claim (see ai/analyzer.ts's prompt for the explicit
  // banned patterns). Used to open a narrated video, never mixed into or presented as Scripture.
  emotionalHook: string;
  visualConcept: string;
  composition: string;
  prompt: string;
  negativePrompt: string;
  // Typeface pairing key for the poster text - see FontStyleKey above.
  fontStyle: FontStyleKey;
  // 6-digit hex accent color for the poster's emphasized clause/reference lines/divider, chosen to
  // suit the color grade the prompt describes. Exact lightness is clamped client-side per
  // light/dark theme for legibility - this field only controls hue/saturation intent.
  accentColor: string;
  provider: 'claude' | 'static-fallback';
}

// Claude-designed poster layout/typography (see ai/posterDesign.ts) - one design applies to both the
// Tamil+English and Telugu+English posters. Every font is limited to families index.html actually
// loads, so a design can never request a face that would silently fall back to a system font.
export type PosterEnglishFont = 'playfair' | 'cormorant' | 'lora' | 'cinzel' | 'montserrat' | 'lato';
export type PosterTamilFont = 'noto-serif-tamil' | 'noto-sans-tamil' | 'arima-madurai';
export type PosterTeluguFont = 'noto-serif-telugu' | 'noto-sans-telugu';
// Where a block sits vertically in the 4:5 frame.
export type PosterAnchor = 'top' | 'upper' | 'middle' | 'lower' | 'bottom';

export interface PosterBlockDesign {
  anchor: PosterAnchor;
  align: 'center' | 'left' | 'right';
  // Text size relative to the renderer's default for that block (0.8 - 1.2).
  sizeScale: number;
}

export interface PosterDesign {
  // Short label shown in the variant picker, e.g. "Quiet split".
  name: string;
  // 'stacked': primary language, divider, English as one group (english.anchor/align ignored).
  // 'split': each language block placed independently.
  arrangement: 'stacked' | 'split';
  primary: PosterBlockDesign;
  english: PosterBlockDesign;
  tamilFont: PosterTamilFont;
  teluguFont: PosterTeluguFont;
  englishFont: PosterEnglishFont;
  englishItalic: boolean;
  primaryWeight: 'regular' | 'bold';
  // 'firstWord': the opening word(s) enlarged in the accent colour; 'none': uniform text.
  heroMode: 'firstWord' | 'none';
  // English hero in a script face (ignored for all-caps words like LORD, which stay in the serif).
  heroScript: boolean;
  divider: 'flourish' | 'rule' | 'none';
  accentColor: string;
  rationale: string;
}
