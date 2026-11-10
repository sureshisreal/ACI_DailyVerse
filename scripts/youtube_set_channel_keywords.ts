// Sets the channel's keywords (Studio -> Settings -> Channel -> Keywords), which were empty - one of
// the few signals YouTube has about what a small channel is about. Uses the same refresh token as
// uploads (scripts/youtube_authorize.ts); the full `youtube` scope already covers channels.update.
//
//   npx tsx scripts/youtube_set_channel_keywords.ts          # preview only
//   npx tsx scripts/youtube_set_channel_keywords.ts --apply  # write to the channel
import '../envLoader';
import { google } from 'googleapis';

const KEYWORDS = [
  'Tamil Christian',
  'Telugu Christian',
  'Tamil Bible verse',
  'Telugu Bible verse',
  'Daily Bible verse',
  'Tamil Christian message',
  'Telugu Christian message',
  'Tamil sermon',
  'Telugu sermon',
  'Chennai church',
  'Apostolic Church of India',
  'ACI',
  'fasting prayer',
  'இன்றைய வசனம்',
  'தினசரி வேத வசனம்',
  'தமிழ் கிறிஸ்தவ செய்தி',
  'ఈ రోజు బైబిల్ వాక్యం',
  'రోజువారీ బైబిల్ వాక్యం',
  'తెలుగు క్రైస్తవ సందేశం',
];

// YouTube's keywords field is one space-separated string; multi-word phrases must be quoted. The
// whole field is capped at 500 characters.
const KEYWORDS_MAX_LENGTH = 500;

function formatKeywords(keywords: string[]): string {
  return keywords.map((k) => (k.includes(' ') ? `"${k}"` : k)).join(' ');
}

async function main() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    console.error('YouTube credentials missing from .env - run scripts/youtube_authorize.ts first.');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');

  const keywords = formatKeywords(KEYWORDS);
  if (keywords.length > KEYWORDS_MAX_LENGTH) {
    console.error(`Keywords are ${keywords.length} characters; YouTube allows ${KEYWORDS_MAX_LENGTH}.`);
    process.exit(1);
  }

  const auth = new google.auth.OAuth2(YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: YOUTUBE_REFRESH_TOKEN });
  const youtube = google.youtube({ version: 'v3', auth });

  const { data } = await youtube.channels.list({ part: ['brandingSettings'], mine: true });
  const channel = data.items?.[0];
  if (!channel?.id) throw new Error('No channel found for this account.');

  const current = channel.brandingSettings?.channel ?? {};
  console.log(`Channel:          ${current.title} (${channel.id})`);
  console.log(`Current keywords: ${current.keywords || '(none)'}`);
  console.log(`New keywords:     ${keywords} (${keywords.length}/${KEYWORDS_MAX_LENGTH} chars)`);

  if (!apply) {
    console.log('\nPreview only - re-run with --apply to write.');
    return;
  }

  // channels.update replaces the whole brandingSettings.channel object, so every existing field
  // (title, description, country, ...) is sent back unchanged alongside the new keywords - omitting
  // one would clear it on the channel.
  await youtube.channels.update({
    part: ['brandingSettings'],
    requestBody: { id: channel.id, brandingSettings: { channel: { ...current, keywords } } },
  });
  console.log('\nKeywords updated.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
