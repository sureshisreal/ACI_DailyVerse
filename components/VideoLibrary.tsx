import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, UploadCloud, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, Instagram, Facebook, Clock, X, CalendarClock } from 'lucide-react';
import {
  fetchLibrary, uploadLibraryVideo, getYoutubeUploadStatus, getInstagramSyncStatus,
  scheduleLibraryVideoForInstagram, getFacebookStatus, sendLibraryVideoToFacebook, scheduleLibraryVideoEverywhere, scheduleWhatsApp,
  libraryFileUrl, type LibraryEntry, type LibraryVideo, type ScheduleAllResult,
} from '../services/verseApi';
import WhatsAppPostButton from './WhatsAppPostButton';

// Everything previous runs wrote to output/, with a way to publish it.
//
// The rest of the app can only upload videos generated in the CURRENT session - those live as blob
// URLs that die with the page - so every video rendered on an earlier day was stranded on disk. That
// is the backlog this exists for: at the time it was written the output tree held 90 portrait Shorts
// and not one of them had ever reached the channel.
//
// Uploads are driven one file at a time from here rather than in a single server-side batch, so the
// row you are watching updates as each finishes and a failure halfway through a long run leaves
// everything before it published.

const KIND_META: Record<LibraryVideo['kind'], { badge: string; hint: string; accent: string }> = {
  short: { badge: 'Short', hint: '1080x1920 portrait', accent: 'text-amber-400 border-amber-500/40' },
  longform: { badge: 'Video', hint: '1920x1080 landscape', accent: 'text-stone-400 border-stone-600' },
};

const LANG_LABEL: Record<LibraryVideo['lang'], string> = { en: 'English', ta: 'Tamil', te: 'Telugu' };

type UploadState = { state: 'idle' | 'uploading' | 'done' | 'error'; url?: string; title?: string; error?: string; warnings?: string[]; publishAt?: string };
type InstagramState = { state: 'posting' | 'done' | 'error'; permalink?: string | null; error?: string };
type FacebookState = { state: 'sending' | 'error'; error?: string };

// The bilingual posters are what go to the WhatsApp Channel (see WhatsAppPanel.tsx).
function hasWhatsAppPosters(entry: LibraryEntry): boolean {
  return entry.posters.some((p) => p.file === 'tamil-english.png' || p.file === 'telugu-english.png');
}

function keyOf(entry: LibraryEntry, video: LibraryVideo): string {
  return `${entry.dir}/${video.file}`;
}

// Every channel is scheduled from the verse's own date (entry.postAt - the date picked in the
// generator, at the server's SOCIAL_POST_TIME). Same 10-minute margin as the server uses.
function isUpcoming(iso: string | null | undefined): iso is string {
  return Boolean(iso) && Date.parse(iso!) >= Date.now() + 10 * 60 * 1000;
}

// Default pick for a custom schedule picker: the verse's go-live time if still upcoming, else
// tomorrow 12:00 AM local, in <input type="datetime-local"> format.
function defaultScheduleValue(entry: LibraryEntry): string {
  if (isUpcoming(entry.postAt)) return toLocalInput(entry.postAt);
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

const CHANNEL_LABEL = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' } as const;

// One line per channel for a schedule-all result, e.g. "YouTube scheduled · Instagram scheduled · Facebook error: ...".
function describeScheduleAll(result: ScheduleAllResult): { text: string; failed: boolean } {
  const parts = (Object.keys(CHANNEL_LABEL) as (keyof typeof CHANNEL_LABEL)[]).map((ch) => {
    const o = result[ch];
    return o.state === 'scheduled' ? `${CHANNEL_LABEL[ch]} scheduled` : `${CHANNEL_LABEL[ch]} ${o.state}: ${o.detail}`;
  });
  return { text: parts.join(' · '), failed: (['youtube', 'instagram', 'facebook'] as const).some((ch) => result[ch].state === 'error') };
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VideoLibrary: React.FC = () => {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [instagramConfigured, setInstagramConfigured] = useState(false);
  const [instagramPosts, setInstagramPosts] = useState<Record<string, InstagramState>>({});
  // Open schedule pickers (key -> datetime-local value) and the one being saved.
  const [schedulePicker, setSchedulePicker] = useState<Record<string, string>>({});
  const [scheduleBusy, setScheduleBusy] = useState<string | null>(null);
  const [facebookConfigured, setFacebookConfigured] = useState(false);
  const [facebookSends, setFacebookSends] = useState<Record<string, FacebookState>>({});
  // Open Facebook schedule pickers (key -> datetime-local value).
  const [facebookPicker, setFacebookPicker] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Schedule-all runs: which entry dir is running ('*' = every upcoming date), and per-video outcomes.
  const [scheduleAllRunning, setScheduleAllRunning] = useState<string | null>(null);
  const [scheduleAllResults, setScheduleAllResults] = useState<Record<string, { text: string; failed: boolean }>>({});
  const [bulkRunning, setBulkRunning] = useState<null | 'short' | 'longform'>(null);
  // Set when a bulk run is asked to stop, read by the loop between videos - a long run should be
  // interruptible without reloading the page and losing what already uploaded. Mirrored into a ref
  // because the upload loop closes over its own render's state: reading the state variable there
  // would see the value as it was when the run started and never notice the cancel.
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRef = useRef(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [runSummary, setRunSummary] = useState<
    { uploaded: number; failed: number; remaining: number; note: string | null } | null
  >(null);

  const requestCancel = () => {
    cancelRef.current = true;
    setCancelRequested(true);
  };

  const load = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setEntries(await fetchLibrary());
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load the library.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    getYoutubeUploadStatus()
      .then((status) => setYoutubeConfigured(status.configured))
      .catch(() => setYoutubeConfigured(false));
    getInstagramSyncStatus()
      .then((status) => setInstagramConfigured(status.instagramConfigured))
      .catch(() => setInstagramConfigured(false));
    getFacebookStatus()
      .then((status) => setFacebookConfigured(status.configured))
      .catch(() => setFacebookConfigured(false));
  }, []);

  // Uploads to the Facebook Page as an unpublished draft (value = null) or scheduled by Facebook for
  // the picked time - never public immediately, so no confirm. Re-reads the library afterwards so the
  // row shows the manifest's record.
  const sendToFacebook = async (entry: LibraryEntry, video: LibraryVideo, value: string | null) => {
    const key = keyOf(entry, video);
    setFacebookSends((prev) => ({ ...prev, [key]: { state: 'sending' } }));
    try {
      await sendLibraryVideoToFacebook(entry.dir, video.file, value ? new Date(value).toISOString() : null);
      setFacebookSends((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
      setFacebookPicker((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err: any) {
      setFacebookSends((prev) => ({ ...prev, [key]: { state: 'error', error: err?.message || 'Facebook upload failed.' } }));
    }
  };

  // Queues one verse's posters for the WhatsApp Channel at its date (or reports why not).
  const queueWhatsApp = async (entry: LibraryEntry) => {
    const key = `${entry.dir}#whatsapp`;
    try {
      const { scheduled } = await scheduleWhatsApp(entry.dir);
      setScheduleAllResults((prev) => ({
        ...prev,
        [key]: { text: scheduled ? `WhatsApp queued for ${formatWhen(scheduled.at)}` : 'WhatsApp not queued - date has passed', failed: false },
      }));
    } catch (err: any) {
      setScheduleAllResults((prev) => ({ ...prev, [key]: { text: `WhatsApp: ${err?.message || 'could not queue'}`, failed: true } }));
    }
  };

  // Schedules every video of the given entries on all three channels for each verse's own date,
  // one video at a time (each may run a YouTube and a Facebook upload). Videos already everywhere
  // are skipped; anything whose date has passed stays unpublished (the server decides per channel).
  const scheduleAllFor = async (targets: LibraryEntry[], runKey: string) => {
    setScheduleAllRunning(runKey);
    try {
      for (const entry of targets) {
        if (hasWhatsAppPosters(entry) && !entry.whatsapp?.at) await queueWhatsApp(entry);
        for (const video of entry.videos) {
          if (video.uploaded && (video.instagram || video.instagramScheduled) && video.facebook) continue;
          const key = keyOf(entry, video);
          try {
            const result = await scheduleLibraryVideoEverywhere(entry.dir, video.file);
            setScheduleAllResults((prev) => ({ ...prev, [key]: describeScheduleAll(result) }));
            const fatal = result.youtube.state === 'error' && /quota|authorization/i.test(result.youtube.detail);
            if (fatal) return;
          } catch (err: any) {
            setScheduleAllResults((prev) => ({ ...prev, [key]: { text: err?.message || 'Could not schedule.', failed: true } }));
          }
        }
      }
    } finally {
      setScheduleAllRunning(null);
      void load();
    }
  };

  const upcomingEntries = (entries || []).filter((e) => isUpcoming(e.postAt) && (e.videos.length > 0 || hasWhatsAppPosters(e)));

  // Saves (value = datetime-local string) or cancels (value = null) a scheduled Instagram post, then
  // re-reads the library so the row shows what the manifest now holds.
  const saveSchedule = async (entry: LibraryEntry, video: LibraryVideo, value: string | null) => {
    const key = keyOf(entry, video);
    setScheduleBusy(key);
    try {
      await scheduleLibraryVideoForInstagram(entry.dir, video.file, value ? new Date(value).toISOString() : null);
      setSchedulePicker((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
      setInstagramPosts((prev) => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
      await load();
    } catch (err: any) {
      setInstagramPosts((prev) => ({ ...prev, [key]: { state: 'error', error: err?.message || 'Could not schedule.' } }));
    } finally {
      setScheduleBusy(null);
    }
  };

  // A video counts as published if this session just uploaded it or if a previous run recorded it in
  // the verse's manifest - both have to count, or a reload would offer to upload everything again.
  const isPublished = (entry: LibraryEntry, video: LibraryVideo): boolean =>
    Boolean(video.uploaded) || uploads[keyOf(entry, video)]?.state === 'done';

  const pendingOf = (kind: LibraryVideo['kind']): { entry: LibraryEntry; video: LibraryVideo }[] =>
    (entries || []).flatMap((entry) =>
      entry.videos
        .filter((video) => video.kind === kind && !isPublished(entry, video))
        .map((video) => ({ entry, video })));

  const counts = useMemo(() => {
    const all = (entries || []).flatMap((e) => e.videos.map((v) => ({ e, v })));
    const per = (kind: LibraryVideo['kind']) => {
      const of = all.filter((x) => x.v.kind === kind);
      return { total: of.length, published: of.filter((x) => isPublished(x.e, x.v)).length };
    };
    return { short: per('short'), longform: per('longform') };
  }, [entries, uploads]);

  // Resolves to 'ok', a recoverable 'error' (this video only), or 'fatal' - the last meaning every
  // remaining upload would fail identically, so a bulk run must stop rather than continue.
  const uploadOne = async (
    entry: LibraryEntry,
    video: LibraryVideo,
  ): Promise<{ outcome: 'ok' | 'error' | 'fatal'; message?: string }> => {
    const key = keyOf(entry, video);
    setUploads((prev) => ({ ...prev, [key]: { state: 'uploading' } }));
    try {
      const result = await uploadLibraryVideo(entry.dir, video.file);
      setUploads((prev) => ({ ...prev, [key]: { state: 'done', url: result.url, title: result.title, warnings: result.warnings, publishAt: result.publishAt } }));
      return { outcome: 'ok' };
    } catch (err: any) {
      const message = err?.message || 'Upload failed.';
      setUploads((prev) => ({ ...prev, [key]: { state: 'error', error: message } }));
      // The message is returned rather than read back out of `uploads`, which would still hold this
      // render's stale snapshot by the time the caller looked.
      return { outcome: err?.data?.fatal ? 'fatal' : 'error', message };
    }
  };

  // Sequential on purpose: these are large uploads against a per-channel quota, and running the
  // whole backlog in parallel is far more likely to fail partway than to finish faster.
  //
  // The run stops on the first fatal error. That matters more than it sounds: YouTube's default
  // quota allows only about six uploads a day, so on a backlog this size the run is EXPECTED to hit
  // the wall partway through. Carrying on regardless would spend a Claude call writing a title for
  // each of the remaining videos before failing every one of them the same way.
  const uploadAllOfKind = async (kind: LibraryVideo['kind']) => {
    const queue = pendingOf(kind);
    setBulkRunning(kind);
    cancelRef.current = false;
    setCancelRequested(false);
    setProgress({ done: 0, total: queue.length });
    setRunSummary(null);

    let uploaded = 0;
    let failed = 0;
    let stoppedBy: string | null = null;

    try {
      for (const { entry, video } of queue) {
        if (cancelRef.current) { stoppedBy = 'Stopped.'; break; }
        const { outcome, message } = await uploadOne(entry, video);
        if (outcome === 'ok') uploaded++;
        else failed++;
        setProgress({ done: uploaded + failed, total: queue.length });
        if (outcome === 'fatal') {
          stoppedBy = message || 'Upload blocked - stopped before the rest.';
          break;
        }
      }
    } finally {
      const remaining = queue.length - uploaded - failed;
      setRunSummary({
        uploaded,
        failed,
        remaining,
        note: stoppedBy,
      });
      setBulkRunning(null);
      cancelRef.current = false;
      setCancelRequested(false);
      setProgress(null);
      // Re-read from disk so the manifest-recorded uploads become the source of truth again.
      void load();
    }
  };

  const busy = bulkRunning !== null || scheduleAllRunning !== null;

  return (
    <div className="mt-10 p-5 bg-stone-900/40 rounded-3xl border border-stone-800">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-400">Previously generated</h2>
          <p className="text-xs text-stone-500 mt-1 max-w-prose">
            Videos already rendered to <code className="text-amber-500/80">output/</code> by earlier runs.
            Titles are written fresh by Claude at upload time. Nothing goes public on upload: every channel
            is scheduled for the verse's date (the date picked when generating), and a verse whose date has
            passed stays unpublished - private on YouTube, a draft on Facebook, not posted to Instagram.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isLoading || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 text-xs font-medium rounded-lg transition-colors"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {!youtubeConfigured && (
        <p className="mt-3 text-xs text-stone-500">
          YouTube upload is off, so these can be browsed but not published.
        </p>
      )}

      {loadError && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{loadError}</div>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(['short', 'longform'] as const).map((kind) => {
            const { total, published } = counts[kind];
            const pending = total - published;
            if (!total) return null;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => uploadAllOfKind(kind)}
                disabled={!youtubeConfigured || busy || pending === 0}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-700 hover:bg-red-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
              >
                {bulkRunning === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                {pending === 0
                  ? `All ${KIND_META[kind].badge}s uploaded (${total})`
                  : `Upload all ${KIND_META[kind].badge}s (${pending})`}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => scheduleAllFor(upcomingEntries, '*')}
            disabled={busy || upcomingEntries.length === 0}
            title="YouTube, Instagram, Facebook and the WhatsApp Channel for every verse whose date is still ahead"
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-700 hover:bg-amber-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
          >
            {scheduleAllRunning === '*' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
            Schedule all upcoming dates ({upcomingEntries.length})
          </button>
          {bulkRunning !== null && (
            <button
              type="button"
              onClick={requestCancel}
              disabled={cancelRequested}
              className="px-3 py-2 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 text-xs font-medium rounded-lg transition-colors"
            >
              {cancelRequested ? 'Stopping after this one...' : 'Stop after current'}
            </button>
          )}
          {progress && (
            <span className="self-center text-xs text-stone-400 font-mono">
              {progress.done} / {progress.total}
            </span>
          )}
        </div>
      )}

      {runSummary && !busy && (
        <div className="mt-3 p-3 bg-stone-950/60 border border-stone-800 rounded-xl text-xs space-y-1">
          <p className="text-stone-300">
            <span className="text-green-400">{runSummary.uploaded} uploaded</span>
            {runSummary.failed > 0 && <span className="text-red-400"> &middot; {runSummary.failed} failed</span>}
            {runSummary.remaining > 0 && <span className="text-stone-500"> &middot; {runSummary.remaining} not attempted</span>}
          </p>
          {runSummary.note && <p className="text-stone-500 leading-relaxed">{runSummary.note}</p>}
        </div>
      )}

      {entries && entries.length === 0 && !isLoading && (
        <p className="mt-4 text-sm text-stone-500">Nothing generated yet - run a verse with Video or Meditation checked.</p>
      )}

      {entries && entries.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {entries.map((entry) => {
            const open = expanded[entry.dir] ?? false;
            const pending = entry.videos.filter((v) => !isPublished(entry, v)).length;
            return (
              <div key={entry.dir} className="bg-stone-950/50 rounded-xl border border-stone-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [entry.dir]: !open }))}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-900/50 transition-colors"
                >
                  {open ? <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-stone-500 flex-shrink-0" />}
                  <span className="text-sm text-stone-300 flex-1 min-w-0 truncate">{entry.reference}</span>
                  <span className="text-[11px] text-stone-600 font-mono flex-shrink-0">{entry.date}</span>
                  <span className={`text-[11px] flex-shrink-0 ${entry.videos.length === 0 ? 'text-stone-600' : pending === 0 ? 'text-green-500/80' : 'text-stone-500'}`}>
                    {entry.videos.length === 0
                      ? `${entry.posters.length} poster${entry.posters.length === 1 ? '' : 's'}`
                      : pending === 0 ? 'all uploaded' : `${pending} to upload`}
                  </span>
                </button>

                {open && (
                  <div className="px-3 pb-3 pt-1 space-y-1.5">
                    {(entry.videos.length > 0 || hasWhatsAppPosters(entry)) && (
                      <div className="pl-7 pb-1 flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => scheduleAllFor([entry], entry.dir)}
                          disabled={busy}
                          className="flex items-center gap-1 px-2.5 py-1 bg-amber-700 hover:bg-amber-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-[11px] font-medium rounded-lg transition-colors"
                        >
                          {scheduleAllRunning === entry.dir ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarClock className="w-3 h-3" />}
                          Schedule all channels
                        </button>
                        <span className="text-[11px] text-stone-500">
                          {isUpcoming(entry.postAt)
                            ? `Goes live ${formatWhen(entry.postAt)} on YouTube, Instagram, Facebook and WhatsApp`
                            : 'Date has passed - stays unpublished (YouTube private, Facebook draft)'}
                        </span>
                        {hasWhatsAppPosters(entry) && (
                          <span className="text-[11px] text-emerald-400/90">
                            {entry.whatsapp?.at
                              ? `WhatsApp ${formatWhen(entry.whatsapp.at)}${entry.whatsapp.posted.length ? ` · ${entry.whatsapp.posted.length} posted` : ''}`
                              : entry.whatsapp?.posted.length ? `WhatsApp · ${entry.whatsapp.posted.length} posted` : 'WhatsApp not queued'}
                          </span>
                        )}
                        {scheduleAllResults[`${entry.dir}#whatsapp`] && (
                          <span className={`w-full text-[11px] ${scheduleAllResults[`${entry.dir}#whatsapp`].failed ? 'text-red-400' : 'text-stone-500'}`}>
                            {scheduleAllResults[`${entry.dir}#whatsapp`].text}
                          </span>
                        )}
                      </div>
                    )}
                    {entry.posters.length > 0 && (
                      <div className="pl-7 pb-2 flex flex-wrap gap-3">
                        {entry.posters.map((poster) => {
                          const url = libraryFileUrl(entry.dir, poster.file);
                          const forWhatsApp = poster.file === 'tamil-english.png' || poster.file === 'telugu-english.png';
                          return (
                            <div key={poster.file} className="flex flex-col items-center gap-1">
                            <a
                              href={url}
                              download={`${entry.reference.replace(/\s+/g, '-')}-${poster.file}`}
                              title={`${poster.label} - click to download`}
                              className="group flex flex-col gap-1"
                            >
                              <img
                                src={url}
                                alt={poster.label}
                                loading="lazy"
                                className="w-16 h-28 object-cover rounded-md border border-stone-700 group-hover:border-amber-500/60 transition-colors bg-stone-900"
                              />
                              <span className="text-[10px] text-stone-500 group-hover:text-amber-500/80 transition-colors max-w-16 leading-tight">
                                {poster.label.replace(' poster', '')}
                              </span>
                            </a>
                            {forWhatsApp && <WhatsAppPostButton dir={entry.dir} file={poster.file} reference={entry.reference} variant="icon" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {entry.videos.length === 0 && (
                      <p className="pl-7 text-[11px] text-stone-600">Posters only - no video was generated for this verse.</p>
                    )}

                    {entry.videos.map((video) => {
                      const key = keyOf(entry, video);
                      const state = uploads[key];
                      const published = isPublished(entry, video);
                      const url = state?.url || video.uploaded?.url;
                      const meta = KIND_META[video.kind];
                      const ig = instagramPosts[key];
                      const onInstagram = Boolean(video.instagram) || ig?.state === 'done';
                      const igLink = ig?.permalink || video.instagram?.permalink;
                      const scheduled = video.instagramScheduled;
                      const pickerValue = schedulePicker[key];
                      const fb = facebookSends[key];
                      const fbPickerValue = facebookPicker[key];
                      return (
                        <div key={video.file} className="flex items-center gap-3 flex-wrap pl-7">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider flex-shrink-0 ${meta.accent}`}>
                            {meta.badge}
                          </span>
                          <span className="text-xs text-stone-400 flex-shrink-0">{LANG_LABEL[video.lang]}</span>
                          <span className="text-[11px] text-stone-600 font-mono flex-1 min-w-0 truncate">
                            {meta.hint} {formatSize(video.sizeBytes) && `· ${formatSize(video.sizeBytes)}`}
                          </span>

                          {published && url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300 flex-shrink-0"
                            >
                              {isUpcoming(state?.publishAt || video.uploaded?.publishAt)
                                ? <><Clock className="w-3.5 h-3.5" /> YouTube {formatWhen((state?.publishAt || video.uploaded?.publishAt)!)}</>
                                : <><CheckCircle2 className="w-3.5 h-3.5" /> On YouTube</>}
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => uploadOne(entry, video)}
                              disabled={!youtubeConfigured || busy || state?.state === 'uploading'}
                              title={isUpcoming(entry.postAt) ? `Uploads private, goes public ${formatWhen(entry.postAt)}` : 'Uploads private (date has passed)'}
                              className="flex items-center gap-1 px-2.5 py-1 bg-red-700 hover:bg-red-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-[11px] font-medium rounded-lg transition-colors flex-shrink-0"
                            >
                              {state?.state === 'uploading'
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <UploadCloud className="w-3 h-3" />}
                              {state?.state === 'uploading' ? 'Uploading...' : state?.state === 'error' ? 'Retry' : 'Upload'}
                            </button>
                          )}

                          {onInstagram ? (
                            igLink ? (
                              <a
                                href={igLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[11px] text-pink-400 hover:text-pink-300 flex-shrink-0"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> On Instagram
                              </a>
                            ) : (
                              <span className="flex items-center gap-1 text-[11px] text-pink-400 flex-shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" /> On Instagram
                              </span>
                            )
                          ) : scheduled && pickerValue === undefined ? (
                            <span className={`flex items-center gap-1.5 text-[11px] flex-shrink-0 ${scheduled.failed ? 'text-red-400' : 'text-pink-300'}`}>
                              <Clock className="w-3.5 h-3.5" />
                              {scheduled.failed ? 'Schedule failed' : `Instagram ${formatWhen(scheduled.at)}`}
                              <button
                                type="button"
                                onClick={() => setSchedulePicker((prev) => ({ ...prev, [key]: toLocalInput(scheduled.at) }))}
                                disabled={scheduleBusy === key}
                                className="text-stone-400 hover:text-stone-200 underline-offset-2 hover:underline"
                              >
                                Change
                              </button>
                              <button
                                type="button"
                                onClick={() => saveSchedule(entry, video, null)}
                                disabled={scheduleBusy === key}
                                title="Cancel scheduled post"
                                className="text-stone-500 hover:text-red-400"
                              >
                                {scheduleBusy === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                              </button>
                            </span>
                          ) : pickerValue !== undefined ? (
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <input
                                type="datetime-local"
                                value={pickerValue}
                                onChange={(e) => setSchedulePicker((prev) => ({ ...prev, [key]: e.target.value }))}
                                className="px-2 py-0.5 bg-stone-900 border border-stone-700 rounded-md text-[11px] text-stone-200 [color-scheme:dark]"
                              />
                              <button
                                type="button"
                                onClick={() => saveSchedule(entry, video, pickerValue)}
                                disabled={!pickerValue || scheduleBusy === key}
                                className="flex items-center gap-1 px-2.5 py-1 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white text-[11px] font-medium rounded-lg transition-colors"
                              >
                                {scheduleBusy === key && <Loader2 className="w-3 h-3 animate-spin" />}
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setSchedulePicker((prev) => {
                                  const { [key]: _, ...rest } = prev;
                                  return rest;
                                })}
                                className="text-[11px] text-stone-500 hover:text-stone-300"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              {isUpcoming(entry.postAt) && (
                                <button
                                  type="button"
                                  onClick={() => saveSchedule(entry, video, toLocalInput(entry.postAt!))}
                                  disabled={!instagramConfigured || scheduleBusy === key}
                                  title={instagramConfigured ? `Schedule the Reel for the verse's date - this app posts it then` : 'Instagram is not configured'}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-pink-700 hover:bg-pink-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-[11px] font-medium rounded-lg transition-colors"
                                >
                                  {scheduleBusy === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <Instagram className="w-3 h-3" />}
                                  {ig?.state === 'error' ? 'Retry Instagram' : `Instagram ${formatWhen(entry.postAt!)}`}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setSchedulePicker((prev) => ({ ...prev, [key]: defaultScheduleValue(entry) }))}
                                disabled={!instagramConfigured || scheduleBusy === key}
                                title="Schedule the Instagram post for later"
                                className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed text-pink-300 text-[11px] font-medium rounded-lg transition-colors"
                              >
                                {isUpcoming(entry.postAt) ? <Clock className="w-3 h-3" /> : <Instagram className="w-3 h-3" />}
                                {isUpcoming(entry.postAt) ? 'Other time' : 'Schedule Instagram'}
                              </button>
                            </span>
                          )}

                          {video.facebook ? (
                            <a
                              href={video.facebook.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Unpublished on your Page - manage it in Meta Business Suite"
                              className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 flex-shrink-0"
                            >
                              {video.facebook.state === 'scheduled' ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              {video.facebook.state === 'scheduled' && video.facebook.scheduledFor
                                ? `Facebook ${formatWhen(video.facebook.scheduledFor)}`
                                : 'Facebook draft'}
                            </a>
                          ) : fbPickerValue !== undefined ? (
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <input
                                type="datetime-local"
                                value={fbPickerValue}
                                onChange={(e) => setFacebookPicker((prev) => ({ ...prev, [key]: e.target.value }))}
                                className="px-2 py-0.5 bg-stone-900 border border-stone-700 rounded-md text-[11px] text-stone-200 [color-scheme:dark]"
                              />
                              <button
                                type="button"
                                onClick={() => sendToFacebook(entry, video, fbPickerValue)}
                                disabled={!fbPickerValue || fb?.state === 'sending'}
                                className="flex items-center gap-1 px-2.5 py-1 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-[11px] font-medium rounded-lg transition-colors"
                              >
                                {fb?.state === 'sending' && <Loader2 className="w-3 h-3 animate-spin" />}
                                {fb?.state === 'sending' ? 'Uploading...' : 'Schedule on Facebook'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setFacebookPicker((prev) => {
                                  const { [key]: _, ...rest } = prev;
                                  return rest;
                                })}
                                disabled={fb?.state === 'sending'}
                                className="text-[11px] text-stone-500 hover:text-stone-300"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => sendToFacebook(entry, video, isUpcoming(entry.postAt) ? toLocalInput(entry.postAt) : null)}
                                disabled={!facebookConfigured || fb?.state === 'sending'}
                                title={!facebookConfigured ? 'Facebook is not configured'
                                  : isUpcoming(entry.postAt) ? "Schedule on your Facebook Page for the verse's date"
                                  : 'Date has passed - upload to your Facebook Page as an unpublished draft'}
                                className="flex items-center gap-1 px-2.5 py-1 bg-sky-700 hover:bg-sky-600 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed text-white text-[11px] font-medium rounded-lg transition-colors"
                              >
                                {fb?.state === 'sending' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Facebook className="w-3 h-3" />}
                                {fb?.state === 'sending' ? 'Uploading...' : fb?.state === 'error' ? 'Retry Facebook'
                                  : isUpcoming(entry.postAt) ? `Facebook ${formatWhen(entry.postAt)}` : 'Facebook draft'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setFacebookPicker((prev) => ({ ...prev, [key]: defaultScheduleValue(entry) }))}
                                disabled={!facebookConfigured || fb?.state === 'sending'}
                                title="Schedule on Facebook - Facebook publishes it at that time, even if this app is off"
                                className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed text-sky-300 text-[11px] font-medium rounded-lg transition-colors"
                              >
                                <Clock className="w-3 h-3" /> Other time
                              </button>
                            </span>
                          )}

                          {scheduleAllResults[key] && (
                            <p className={`w-full pl-7 text-[11px] ${scheduleAllResults[key].failed ? 'text-red-400' : 'text-stone-500'}`}>
                              {scheduleAllResults[key].text}
                            </p>
                          )}
                          {state?.state === 'error' && (
                            <p className="w-full pl-7 text-[11px] text-red-400">{state.error}</p>
                          )}
                          {fb?.state === 'error' && (
                            <p className="w-full pl-7 text-[11px] text-red-400">Facebook: {fb.error}</p>
                          )}
                          {ig?.state === 'error' && (
                            <p className="w-full pl-7 text-[11px] text-red-400">Instagram: {ig.error}</p>
                          )}
                          {scheduled?.lastError && (
                            <p className="w-full pl-7 text-[11px] text-red-400">
                              Scheduled Instagram post {scheduled.failed ? 'gave up' : 'will retry'}: {scheduled.lastError}
                            </p>
                          )}
                          {state?.state === 'done' && state.title && (
                            <p className="w-full pl-7 text-[11px] text-stone-500 truncate">{state.title}</p>
                          )}
                          {state?.state === 'done' && state.warnings?.map((warning) => (
                            <p key={warning} className="w-full pl-7 text-[11px] text-amber-400">{warning}</p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default VideoLibrary;
