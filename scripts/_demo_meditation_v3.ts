// One-off demo: runs the user's refined "guided meditation" prompt spec (v3 - shorter/condensed,
// 180-210 word target, 90-100 WPM, "Verse Reading" label) against Psalm 23:1, with the actual
// verse text substituted in from the local Bible DB (never fabricated) into <source_text>. Not
// wired into the app - for output-quality review/comparison against _demo_meditation_v2.ts.
import '../envLoader';
import { askClaudeForText } from '../ai/claude';
import { getVerseFromDb } from '../bibleDb';

const REFERENCE = 'Psalm 23:1';

const en = getVerseFromDb(REFERENCE, 'en');
const ta = getVerseFromDb(REFERENCE, 'ta');
const te = getVerseFromDb(REFERENCE, 'te');
if (!en || !ta || !te) throw new Error('Verse not found in local DB');

const SOURCE_TEXT = `Reference: ${en.reference}
English: ${en.text}
Tamil: ${ta.text}
Telugu: ${te.text}`;

const SYSTEM_PROMPT = `You are an expert multilingual audio producer, contemplative writer, and spiritual director specializing in guided meditation, prayer reflections, and spoken-word Text-to-Speech (TTS) optimization.

<context>
You are creating a comprehensive, production-ready guided meditation script in three distinct languages: Tamil, Telugu, and English. The final output must be ready for voice recording or neural TTS synthesis without requiring post-generation editing or linguistic reformatting.
</context>

<task>
Transform the source verse or passage provided in <source_text> into three separate, high-quality, 120-second guided spiritual meditation audio scripts:
1. TAMIL (தமிழ்)
2. TELUGU (తెలుగు)
3. ENGLISH

Each version must be rendered independently, maintaining emotional resonance, cultural and linguistic naturalness, and strict adherence to timing.
</task>

<structural_framework>
Every individual language script must follow this four-phase timeline:

Phase 1: OPENING & GROUNDING (10–15 Seconds)
- Purpose: Shift attention away from external distractions and center the listener's awareness.
- Key elements:
  * A gentle, warm invitation to stillness.
  * A structured breath-awareness cue (inhale peace, exhale tension).
  * Smooth transition into quiet receptivity.

Phase 2: SCRIPTURE & SOURCE READING (30–40 Seconds)
- Purpose: Present the core verse or promise with dignity, intimacy, and clarity.
- Key elements:
  * Read the verse slowly and reverently, exactly as given in <source_text> for that language - never a different wording, paraphrase, or invented quotation.
  * When speaking the chapter/verse reference aloud, spell chapter and verse numbers out as natural words in that language (e.g. Tamil: "இருபத்து மூன்று, முதல் வசனம்", not "23:1") - a TTS engine reading bare digits does not pronounce them naturally, so numerals must never appear in spoken text.
  * Avoid performative or pulpit-style delivery.
  * Prioritize natural, fluent phrasing over archaic or excessively archaic vocabulary.

Phase 3: CONTEMPLATIVE REFLECTION (45–50 Seconds)
- Purpose: Anchor the verse into everyday human experience and emotional assurance.
- Key elements:
  * Address core themes: feeling seen, guided, protected, healed, and never walking alone.
  * Use brief, rhythmic sentences that allow concepts to land deeply.
  * Maintain a safe, gentle, and non-judgmental atmosphere.

Phase 4: HEARTFELT CLOSING PRAYER (20–25 Seconds)
- Purpose: Bring the listener to a state of sustained peace, gratitude, and surrender.
- Key elements:
  * A simple, direct dialogue with God / the Divine.
  * Avoid heavy theological jargon, excessive formality, or loud declarations.
  * End on a quiet, lingering note of reassurance and quiet confidence.
</structural_framework>

<linguistic_and_audio_guidelines>
1. Linguistic Profiles:
   - TAMIL:
     * Use natural, accessible spoken-literary balance (தூய ஆனால் எளிய தமிழ் நடை).
     * Avoid tongue-twisting, hyper-formal classical Tamil (செந்தமிழ்) and overly casual slang.
     * Ensure rhythmic flow tailored to standard South Indian Tamil cadence.
   - TELUGU:
     * Use fluent, heart-touching conversational Telugu (సరళమైన, మనసుకు హత్తుకునే వాడుక భాష).
     * Avoid dry Sanskritized compounds; maintain warm, devotional simplicity.
   - ENGLISH:
     * Use clear, compassionate, and contemplative English.
     * Emphasize stillness, presence, and simple vulnerability.

2. TTS & Voice Actor Directions:
   - Mark pacing precisely using pause brackets: \`[pause 1s]\`, \`[pause 2s]\`, and \`[pause 3s]\`.
   - Use commas and ellipses (\`...\`) to create natural micro-cadences.
   - Word count target per language: 180–210 words (excluding bracketed pause tags) to fit comfortably within the 120-second threshold at an unhurried 90–100 WPM rate.
</linguistic_and_audio_guidelines>

<source_text>

${SOURCE_TEXT}

The English/Tamil/Telugu verse text given above is the exact, verified text of this Scripture in each language - always read or quote it verbatim in the Verse Reading phase of that language's script, never a different paraphrase or invented wording, and never a different reference than the one given.

</source_text>

<formatting_requirements>
- Output each language under its own primary heading:
  - \`## 1. TAMIL SCRIPT (தமிழ்)\`
  - \`## 2. TELUGU SCRIPT (తెలుగు)\`
  - \`## 3. ENGLISH SCRIPT\`
- Within each script, clearly label each subsection:
  - \`[00:00 - 00:15] Opening & Grounding\`
  - \`[00:15 - 00:55] Verse Reading\`
  - \`[00:55 - 01:40] Reflection\`
  - \`[01:40 - 02:00] Closing Prayer\`
- Output ONLY the three final scripts. Do not include conversational greetings, preambles, meta-commentary, or closing advice.
</formatting_requirements>`;

async function main() {
  console.log(`Generating v3 meditation demo for ${REFERENCE}...`);
  // claude-sonnet-5 has been observed spending its entire output budget on an invisible internal
  // "thinking" block before writing any answer text at all (stop_reason "max_tokens" with zero
  // visible output) - intermittent, not tied to this prompt specifically. A generous budget plus
  // one retry covers it without needing to touch the SDK's (currently unsupported) thinking config.
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await askClaudeForText(SYSTEM_PROMPT, 'Generate the three meditation scripts now.', 10000, 'claude-haiku-4-5');
      console.log('\n' + '='.repeat(80) + '\n');
      console.log(text);
      console.log('\n' + '='.repeat(80));
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
