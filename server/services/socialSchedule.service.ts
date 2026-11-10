import fs from 'fs';
import path from 'path';
import { resolveLibraryAsset, uploadLibraryVideo, libraryEntryDate } from './library.service';
import { isYoutubeUploadConfigured, setYoutubePublishAt } from './youtube.service';
import { isInstagramConfigured } from './instagram.service';
import { scheduleLibraryVideoForInstagram } from './instagramSync.service';
import { isFacebookConfigured, sendLibraryVideoToFacebook } from './facebook.service';
import { upcomingPostTime, MIN_SCHEDULE_LEAD_MS } from '../utils/postTime';

// One library video onto every social channel at once, all timed from the same go-live moment: the
// verse's date from the generator at SOCIAL_POST_TIME (or an explicit `at`). Nothing is made public
// immediately - each channel is either scheduled for that time or left unpublished when the date has
// already passed:
//   YouTube   - uploaded private with publishAt (or an existing private upload rescheduled); past -> private.
//   Instagram - held by the in-app scheduler (Instagram's API has no drafts or native scheduling); past -> not posted.
//   Facebook  - natively scheduled on the Page; past -> unpublished draft.
// YouTube runs first so the Instagram/Facebook captions reuse its title and description.

export type ChannelOutcome =
  | { state: 'scheduled'; at: string }
  | { state: 'unpublished'; detail: string }
  | { state: 'already'; detail: string }
  | { state: 'skipped'; detail: string }
  | { state: 'error'; detail: string };

export interface ScheduleAllResult {
  at: string | null;
  youtube: ChannelOutcome;
  instagram: ChannelOutcome;
  facebook: ChannelOutcome;
}

function readManifestFor(dir: string, file: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(resolveLibraryAsset(dir, file).absPath), 'manifest.json'), 'utf-8'));
  } catch {
    return {};
  }
}

const errorOf = (err: any): ChannelOutcome => ({ state: 'error', detail: err?.message || String(err) });

export async function scheduleLibraryVideoEverywhere(dir: string, file: string, at?: string | null): Promise<ScheduleAllResult> {
  let when: Date | null;
  if (at) {
    when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new Error('Invalid date/time.');
    if (when.getTime() < Date.now() + MIN_SCHEDULE_LEAD_MS) throw new Error('Pick a time at least 10 minutes from now.');
  } else {
    when = upcomingPostTime(libraryEntryDate(dir));
  }
  const iso = when?.toISOString() ?? null;

  let youtube: ChannelOutcome;
  const existingYoutube = readManifestFor(dir, file).youtube?.[file];
  if (!isYoutubeUploadConfigured()) youtube = { state: 'skipped', detail: 'YouTube is not configured.' };
  else if (existingYoutube?.videoId) {
    try {
      if (!when) youtube = { state: 'already', detail: 'Already on YouTube.' };
      else if (await setYoutubePublishAt(existingYoutube.videoId, when)) youtube = { state: 'scheduled', at: iso! };
      else youtube = { state: 'already', detail: 'Already public on YouTube.' };
    } catch (err) {
      youtube = errorOf(err);
    }
  } else {
    try {
      await uploadLibraryVideo(dir, file, when);
      youtube = when ? { state: 'scheduled', at: iso! } : { state: 'unpublished', detail: 'Uploaded private - date has passed.' };
    } catch (err) {
      youtube = errorOf(err);
    }
  }

  let instagram: ChannelOutcome;
  if (!isInstagramConfigured()) instagram = { state: 'skipped', detail: 'Instagram is not configured.' };
  else if (readManifestFor(dir, file).instagram?.[file]) instagram = { state: 'already', detail: 'Already posted to Instagram.' };
  else if (!when) instagram = { state: 'unpublished', detail: 'Not posted - date has passed.' };
  else {
    try {
      scheduleLibraryVideoForInstagram(dir, file, iso!);
      instagram = { state: 'scheduled', at: iso! };
    } catch (err) {
      instagram = errorOf(err);
    }
  }

  let facebook: ChannelOutcome;
  const existingFacebook = readManifestFor(dir, file).facebook?.[file];
  if (!isFacebookConfigured()) facebook = { state: 'skipped', detail: 'Facebook is not configured.' };
  else if (existingFacebook) facebook = { state: 'already', detail: `Already on Facebook (${existingFacebook.state}).` };
  else {
    try {
      await sendLibraryVideoToFacebook(dir, file, iso);
      facebook = when ? { state: 'scheduled', at: iso! } : { state: 'unpublished', detail: 'Uploaded as a draft - date has passed.' };
    } catch (err) {
      facebook = errorOf(err);
    }
  }

  return { at: iso, youtube, instagram, facebook };
}
