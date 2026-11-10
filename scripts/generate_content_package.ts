// Demo/CLI runner for ai/contentPackage.ts - generates the full verse+poster+video+meditation
// creative-brief package for one Bible reference and writes it as Markdown matching the
// user-specified output format. Run with: npx tsx scripts/generate_content_package.ts "Psalm 23:1"
import '../envLoader';
import fs from 'fs';
import path from 'path';
import { generateContentPackage, type LanguagePackage, type ContentPackage } from '../ai/contentPackage';

const LANG_HEADERS: Record<'en' | 'ta' | 'te', string> = {
  en: '## 🇬🇧 ENGLISH',
  ta: '# 🇮🇳 தமிழ்',
  te: '# 🇮🇳 తెలుగు',
};

function renderLanguageSection(lang: 'en' | 'ta' | 'te', pkg: LanguagePackage): string {
  const lines: string[] = [];
  lines.push(LANG_HEADERS[lang], '');
  lines.push('### Bible Verse', pkg.verse, '');
  lines.push('### 🌿 Morning Thought', pkg.moment.morningThought, '');
  lines.push("### 🙏 Today's Prayer", pkg.moment.prayer, '');
  lines.push('### 🌸 Closing Blessing', pkg.moment.closingBlessing, '');
  lines.push('', '## 🎨 POSTER', '');
  lines.push('### Poster Text', `${pkg.poster.title}\n${pkg.poster.morningMessage}\n${pkg.poster.closingLine}`, '');
  lines.push('### Visual Concept', pkg.poster.visualConcept, '');
  lines.push('### Color Palette', pkg.poster.colorPalette, '');
  lines.push('### Typography', pkg.poster.typography, '');
  lines.push('### Background Description', pkg.poster.backgroundDescription, '');
  lines.push('', '## 🎬 VIDEO', '');
  lines.push('### Title', pkg.video.title, '');
  lines.push('### Hook', pkg.video.hook, '');
  lines.push('### Voiceover Script', pkg.video.voiceoverScript, '');
  lines.push('### Storyboard', pkg.video.storyboard, '');
  lines.push('### On-Screen Text', pkg.video.onScreenText, '');
  lines.push('### Voice Direction', pkg.video.voiceDirection, '');
  lines.push('### Music Direction', pkg.video.musicDirection, '');
  lines.push('', '## 🧘 MEDITATION', '');
  lines.push('### Meditation Title', pkg.meditation.title, '');
  lines.push('### 3–5 Minute Meditation Script', pkg.meditation.script, '');
  lines.push('### Voice Direction', pkg.meditation.voiceDirection, '');
  lines.push('### Background Sound', pkg.meditation.backgroundSound, '');
  return lines.join('\n');
}

function renderMarkdown(pkg: ContentPackage): string {
  return [
    `# 📖 ${pkg.reference}`,
    '',
    renderLanguageSection('en', pkg.en),
    '',
    renderLanguageSection('ta', pkg.ta),
    '',
    renderLanguageSection('te', pkg.te),
    '',
  ].join('\n');
}

async function main() {
  const reference = process.argv[2];
  if (!reference) {
    console.error('Usage: npx tsx scripts/generate_content_package.ts "<Bible reference>"');
    process.exit(1);
  }

  console.log(`Generating content package for "${reference}"...`);
  const pkg = await generateContentPackage(reference);

  const outDir = path.join(process.cwd(), 'output', 'content-packages');
  fs.mkdirSync(outDir, { recursive: true });
  const slug = pkg.reference.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  fs.writeFileSync(path.join(outDir, `${slug}.json`), JSON.stringify(pkg, null, 2), 'utf-8');
  const markdown = renderMarkdown(pkg);
  fs.writeFileSync(path.join(outDir, `${slug}.md`), markdown, 'utf-8');

  console.log(`Saved: output/content-packages/${slug}.json and .md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
