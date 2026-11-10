# Daily Bible Verse Generator 📸✨

Enter a date and a Bible reference (e.g. `Psalm 23:1`). The app looks up the exact English, Tamil
and Telugu verse text from local, offline SQLite Bible databases, asks Claude for a compact
verse-grounded visual concept (plus a font/color pairing for the poster text), generates one
background image via Pollinations.ai's free hosted image API, and lays it into two bilingual
devotional posters - **Tamil + English** and **Telugu + English** - sharing the same background.

```
Date + Bible Reference
        ↓
   SQLite (Db/kjv.db, tamil.db, telugu.db)
        ↓
English + Tamil + Telugu verse text
        ↓
   Claude (visual concept + image prompt + font/color pairing, cached)
        ↓
   Pollinations.ai (hosted image generation, cached)
        ↓
   ONE background image
        ↓
Tamil + English poster   /   Telugu + English poster
```

Scripture text always comes from the SQLite databases in `Db/` - never from Claude, never
hardcoded. Claude never sees or produces the final image; it only returns a short JSON visual
brief that the image-generation prompt is built from, plus a poster typeface/accent-color choice
(see `ai/analyzer.ts`).

> **Why a hosted image API instead of a local one?** This app originally generated backgrounds with
> a local ComfyUI install (FLUX/SDXL). On a machine with limited unified memory, local diffusion
> models thrash system swap badly enough to take minutes per step, and FLUX's fp8 checkpoints hit an
> unrelated `Float8_e4m3fn` crash on Apple's MPS backend. Pollinations.ai is free, requires no API
> key, and offloads generation to its own servers - no local GPU/memory constraints at all.

---

## Prerequisites

1. **Node.js 22.5+** (the built-in `node:sqlite` module reads the Bible databases). Check with `node -v`.
2. An **Anthropic API key** for Claude (get one at [console.anthropic.com](https://console.anthropic.com)).
3. Internet access to `image.pollinations.ai` for background image generation - no account or API key needed.

## Setup

```bash
npm install
cp .env.example .env   # if present, otherwise create .env yourself
```

In `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# CLAUDE_MODEL=claude-haiku-4-5   # optional override (default: claude-haiku-4-5, the cheapest)
# CLAUDE_EFFORT=low              # optional: low | medium | high | xhigh | max (ignored by Haiku)

# Fallbacks when Claude is unavailable (no credits, bad key, rate limit) - see ai/claude.ts.
# LLM_PROVIDER=auto              # auto (default): anthropic -> gemini -> groq -> ollama, skipping keyless cloud ones
#                                # or one name (anthropic | gemini | groq | ollama), or a list: gemini,groq,ollama
# Fast free cloud fallbacks (seconds per call):
# GEMINI_API_KEY=...             # free key: https://aistudio.google.com/apikey
# GEMINI_MODEL=...               # default: a fallback list of current Flash models (see ai/claude.ts)
# GROQ_API_KEY=...               # free key: https://console.groq.com/keys
# GROQ_MODEL=...                 # default: auto-picked from Groq's live model list
# Free local fallback via Ollama (https://ollama.com) - private but slow on CPU (minutes per call):
# OLLAMA_MODEL=gemma3:12b        # needs image support + Tamil/Telugu; install with: ollama pull gemma3:12b
# OLLAMA_URL=http://localhost:11434
# OLLAMA_TIMEOUT_MS=600000

# Instagram auto-post (see server/services/instagramSync.service.ts): Shorts uploaded to YouTube from
# this app are posted to Instagram as Reels once they turn public on YouTube. Needs an Instagram
# professional account linked to a Facebook Page and a Meta app token - never the account password.
# INSTAGRAM_ACCESS_TOKEN=...      # long-lived token: instagram_basic, instagram_content_publish, pages_show_list
# INSTAGRAM_USER_ID=...           # Instagram professional account id
# INSTAGRAM_SYNC_INTERVAL_MIN=10  # how often to check YouTube
# INSTAGRAM_MAX_PER_RUN=3         # posts per check
# INSTAGRAM_INCLUDE_LONGFORM=false # also post landscape meditation videos
# INSTAGRAM_SYNC_SINCE=2026-10-02T00:00:00Z  # only YouTube uploads after this (default: when first enabled)

# Facebook Page (see server/services/facebook.service.ts): library videos go up as unpublished drafts
# or natively scheduled posts - never public immediately. Shorts become Reels. Both values are
# printed by scripts/instagram_facebook_token.ts (token scopes also need pages_manage_posts, publish_video).
# FACEBOOK_PAGE_ID=...
# FACEBOOK_PAGE_ACCESS_TOKEN=...

# Every channel is scheduled from the verse's date (the Date picked in the generator) at this time,
# server local time (default 00:00 = midnight): YouTube publishAt, the in-app Instagram scheduler,
# Facebook's native schedule, the WhatsApp queue. Today's verse generated after that time goes out
# ~15 minutes later; earlier dates stay unpublished (YouTube private, Facebook draft, Instagram not posted).
# SOCIAL_POST_TIME=00:00

# WhatsApp Channel (see server/services/whatsapp.service.ts): posters are queued for each verse's date
# and shown in the app's WhatsApp panel when due, to share/paste into the Channel - WhatsApp has no
# Channel posting API, so this step stays a tap.
# WHATSAPP_CHANNEL_URL=https://whatsapp.com/channel/0029VbBlepcGehEPFRz70c1x

# Optional - only needed to raise Pollinations.ai's anonymous rate limit or point at a mirror:
# POLLINATIONS_REFERRER=your-app-name
# POLLINATIONS_TIMEOUT_MS=60000
```

Then run the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## How it works

- **Bible lookup** (`bibleDb.ts`, `server/services/verse.service.ts`) - reads `Db/kjv.db`,
  `Db/tamil.db`, `Db/telugu.db` directly. No JSON verse data, no AI-assisted lookup. A reference
  missing from a language comes back as `null` for that language only; the app never substitutes
  a different verse.
- **Claude analysis** (`ai/claude.ts`, `ai/analyzer.ts`) - one small request per unique verse
  (reference + all three language texts), returning `{theme, emotion, visualConcept, composition,
  prompt, negativePrompt, fontStyle, accentColor}`. Cached to `cache/analysis/<hash>.json` keyed on
  verse content + an analyzer version, so an identical verse never calls Claude twice.
- **Background image generation** (`server/services/image-generation.service.ts`) - one HTTP GET to
  Pollinations.ai's free, keyless image API per verse, cached to `cache/images/<hash>.jpg`, reused
  for both posters. No local model/GPU involved.
- **Posters** (`components/posterRenderer.ts`) - draws the shared background plus the exact DB
  verse text (target language + English) onto a canvas, with auto-shrinking word wrap so nothing
  clips, using the font pairing and accent color Claude chose for that verse's mood.
- **Output** - each generation is saved to `output/YYYY/MM/DD/reference/` as `background.png`,
  `tamil-english.png`, `telugu-english.png`, and `manifest.json`.

## Optional: narration, captions, video

TTS narration (Piper for English/Telugu, Indic Parler-TTS for Tamil), Whisper-based caption
alignment, and FFmpeg Ken Burns video/thumbnail generation are preserved as standalone endpoints
(`/api/verse-audio`, `/api/align-captions`, `/api/video/generate`, `/api/thumbnail/generate`) but
are not part of the main Daily Verse flow and require no configuration to leave unused. See
`scripts/piper_synthesize.py` and `scripts/indic_parler_synthesize.py` for the one-time local
voice-model setup if you want them.

## Troubleshooting

- **"wasn't found in the local Bible database"** - check the reference format (e.g. `John 3:16`,
  `Philippians 4:6-7`). The SQLite databases in `Db/` are the only Scripture source; there is no
  manual override file.
- **"Image generation service returned 429"** - Pollinations.ai's free anonymous tier is rate
  limited (about one request per 15 seconds). Wait a few seconds and try again, or set
  `POLLINATIONS_REFERRER` to identify this app for a looser limit.
- **"Failed to reach the image generation service"** - check internet connectivity to
  `image.pollinations.ai`.
- **Generation is slow / "Your credit balance is too low"** - Claude has no credits, so calls are
  going to the local Ollama model, which takes minutes on a CPU. Set `GEMINI_API_KEY` and/or
  `GROQ_API_KEY` (free keys; Codespaces secrets in a codespace) to fall back to a fast cloud model instead.
- **Claude unavailable** (no `ANTHROPIC_API_KEY`, network error) - the app falls back to a generic
  (non-verse-specific) visual concept and the default gold/classic-serif poster styling, rather
  than blocking poster generation.

### Building for production

```bash
npm run build
npm start
```
