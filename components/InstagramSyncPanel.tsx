import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { getInstagramSyncStatus, runInstagramSync, type InstagramSyncStatus } from '../services/verseApi';

// Status of the YouTube -> Instagram auto-posting (server/services/instagramSync.service.ts): once a
// video uploaded to YouTube turns public there, the server posts the same file to Instagram as a
// Reel. Nothing to operate here day to day - this shows whether it's on, what it last did, and lets
// you run a check immediately instead of waiting for the next scheduled pass.

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

const InstagramSyncPanel: React.FC = () => {
  const [status, setStatus] = useState<InstagramSyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const load = async () => {
    try {
      setStatus(await getInstagramSyncStatus());
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load Instagram status.');
    }
  };

  useEffect(() => { void load(); }, []);

  const checkNow = async () => {
    setIsChecking(true);
    try {
      await runInstagramSync();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Instagram check failed.');
    } finally {
      setIsChecking(false);
    }
  };

  const ready = status?.instagramConfigured && status?.youtubeConfigured;

  return (
    <div className="mt-10 p-5 bg-stone-900/40 rounded-3xl border border-stone-800">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-stone-400">Instagram auto-post</h2>
          <p className="text-xs text-stone-500 mt-1 max-w-prose">
            Reels are scheduled for each verse's date along with YouTube and Facebook (Instagram has no drafts,
            so this app holds them and posts at that time). Shorts uploaded to YouTube without an Instagram
            schedule are posted once they turn public there.
            {status && ` Checked every ${status.intervalMinutes} minutes while the app is running.`}
          </p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={!ready || isChecking}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 text-xs font-medium rounded-lg transition-colors"
        >
          {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Check now
        </button>
      </div>

      {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{error}</div>}

      {status && !status.instagramConfigured && (
        <p className="mt-3 text-xs text-amber-400/90">
          Off - set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_USER_ID in .env (Meta app + Instagram professional account) and restart the server.
        </p>
      )}
      {status && status.instagramConfigured && !status.youtubeConfigured && (
        <p className="mt-3 text-xs text-amber-400/90">Off - YouTube upload isn't configured, so there is nothing to follow.</p>
      )}

      {status && ready && (
        <div className="mt-4 text-xs text-stone-400 space-y-1">
          <div>Posting YouTube uploads made since: <span className="text-stone-300">{formatTime(status.enabledSince)}</span></div>
          <div>Last check: <span className="text-stone-300">{formatTime(status.lastRunAt)}</span>{status.lastSummary && ` - ${status.lastSummary}`}</div>
        </div>
      )}

      {status && status.scheduled?.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-500 mb-1.5">Scheduled</h3>
          <ul className="space-y-1.5 text-xs">
            {status.scheduled.map((s) => (
              <li key={`${s.dir}-${s.file}`} className="flex items-center justify-between gap-3 p-2 bg-stone-950/40 rounded-lg border border-stone-800">
                <span className="text-stone-300 truncate">{s.reference} <span className="text-stone-500">· {s.file}</span></span>
                <span className={`shrink-0 ${s.failed ? 'text-red-400' : 'text-pink-300'}`} title={s.lastError}>
                  {s.failed ? 'Failed' : formatTime(s.at)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-stone-600">Posts go out within a minute of their time while the app is running. Schedule or cancel from the library above.</p>
        </div>
      )}

      {status && status.recentPosts.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs">
          {status.recentPosts.map((post) => (
            <li key={`${post.reference}-${post.file}`} className="flex items-center justify-between gap-3 p-2 bg-stone-950/40 rounded-lg border border-stone-800">
              <span className="text-stone-300 truncate">{post.reference} <span className="text-stone-500">· {post.file}</span></span>
              <span className="flex items-center gap-3 shrink-0">
                <span className="text-stone-500">{formatTime(post.postedAt)}</span>
                {post.permalink && (
                  <a href={post.permalink} target="_blank" rel="noreferrer" className="text-amber-500 hover:text-amber-400">View</a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default InstagramSyncPanel;
