import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeYoutubeTitle, YOUTUBE_TITLE_MAX_LENGTH } from '../server/utils/youtubeTitle';

// Inputs are real titles from the channel as of 2026-09-28.
test('strips hashtags and JSON leftovers', () => {
  assert.equal(
    sanitizeYoutubeTitle('கடந்த காலம் உங்களை சுமையாக்குகிறதா? - ஏசாயா 65:17 #நம்பிக்கை #தமிழ்பிரசங்கம் #புதியபடைப்பு",'),
    'கடந்த காலம் உங்களை சுமையாக்குகிறதா? - ஏசாயா 65:17',
  );
  assert.equal(
    sanitizeYoutubeTitle("When You're Waiting for God's Direction | Psalm 25:5.  #GodIsLeading #WaitingOnGod  #FaithInTheWait,"),
    "When You're Waiting for God's Direction | Psalm 25:5",
  );
});

test('normalizes slug, dashed, spaced and lowercase references', () => {
  assert.equal(
    sanitizeYoutubeTitle('God Is Singing Over You—Even When You Feel Unseen zephaniah-3-17'),
    'God Is Singing Over You—Even When You Feel Unseen Zephaniah 3:17',
  );
  assert.equal(
    sanitizeYoutubeTitle('God Is Singing Over You—Even When You Feel Unseen zephaniah - 3:17'),
    'God Is Singing Over You—Even When You Feel Unseen Zephaniah 3:17',
  );
  assert.equal(
    sanitizeYoutubeTitle("When Your Past Won't Let Go: God Creates Something New - isaiah 65: 17"),
    "When Your Past Won't Let Go: God Creates Something New - Isaiah 65:17",
  );
});

test('leaves clean titles untouched', () => {
  for (const clean of [
    'When You Feel Abandoned by God—Nehemiah 9:31',
    'பயம் மேலோங்கும் நேரம்... நீங்கள் தனியாக இல்லை (உபாகமம் 31:6)',
    'దేవుడు నిన్ను వదిలేశాడా? నెహెమ్యా 9:31 నీకోసమే',
    'Say "Yes" to God — Joshua 24:15',
  ]) {
    assert.equal(sanitizeYoutubeTitle(clean), clean);
  }
});

test('drops a leading combining mark and angle brackets', () => {
  assert.equal(sanitizeYoutubeTitle('ాతం భారంగా ఉందా?'), 'తం భారంగా ఉందా?');
  assert.equal(sanitizeYoutubeTitle('God <is> near'), 'God is near');
});

test('caps length at a word boundary', () => {
  const long = 'word '.repeat(40) + 'Psalm 23:1';
  const out = sanitizeYoutubeTitle(long);
  assert.ok(out.length <= YOUTUBE_TITLE_MAX_LENGTH);
  assert.ok(!out.endsWith(' '));
  assert.ok(out.endsWith('word'));
});
