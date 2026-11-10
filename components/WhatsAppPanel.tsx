import React, { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Copy, Download, CheckCircle2, Bell, X, Image as ImageIcon } from 'lucide-react';
import {
  getWhatsAppQueue, markWhatsAppPosted, cancelWhatsApp, libraryFileUrl,
  type WhatsAppQueue, type WhatsAppQueueItem,
} from '../services/verseApi';
import WhatsAppPostButton, { WhatsAppIcon } from './WhatsAppPostButton';

// WhatsApp Channel queue (server/services/whatsapp.service.ts). WhatsApp has no API for posting to
// Channels, so each verse's posters are scheduled for its date like every other channel, and when
// they come due they show here ready to go: Post to WhatsApp (WhatsAppPostButton - share sheet, or
// copy + open the Channel), or Copy image / Copy caption by hand, then Mark posted. Checked every minute while the page is
// open, with a browser notification when something new comes due.

const POLL_MS = 60_000;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function posterBlob(dir: string, file: string): Promise<Blob> {
  const res = await fetch(libraryFileUrl(dir, file));
  if (!res.ok) throw new Error('Could not load the poster.');
  return res.blob();
}

const WhatsAppPanel: React.FC = () => {
  const [queue, setQueue] = useState<WhatsAppQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Record<string, string>>({});
  const [notifyOn, setNotifyOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  const seenDue = useRef<Set<string> | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const next = await getWhatsAppQueue();
      setQueue(next);
      setError(null);
      // Notify for items that became due since the last check (not for the backlog on first load).
      const dueKeys = new Set(next.due.map((d) => d.dir));
      if (seenDue.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const fresh = next.due.filter((d) => !seenDue.current!.has(d.dir));
        if (fresh.length) {
          new Notification('WhatsApp Channel post due', { body: fresh.map((d) => d.reference).join(', ') });
        }
      }
      seenDue.current = dueKeys;
    } catch (err: any) {
      setError(err?.message || 'Could not load the WhatsApp queue.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const showFlash = (key: string, text: string) => {
    setFlash((prev) => ({ ...prev, [key]: text }));
    setTimeout(() => setFlash((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    }), 2500);
  };

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    setNotifyOn((await Notification.requestPermission()) === 'granted');
  };

  const copyImage = async (item: WhatsAppQueueItem, poster: WhatsAppQueueItem['posters'][number]) => {
    const key = `${item.dir}/${poster.file}`;
    try {
      const blob = await posterBlob(item.dir, poster.file);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      showFlash(key, 'Image copied - paste it into the Channel.');
    } catch (err: any) {
      showFlash(key, err?.message || 'Could not copy the image.');
    }
  };

  const copyCaption = async (key: string, caption: string) => {
    try {
      await navigator.clipboard.writeText(caption);
      showFlash(key, 'Caption copied.');
    } catch {
      showFlash(key, 'Could not copy the caption.');
    }
  };

  const markPosted = async (item: WhatsAppQueueItem, file: string) => {
    const key = `${item.dir}/${file}`;
    setBusy(key);
    try {
      await markWhatsAppPosted(item.dir, file, true);
      await load();
    } catch (err: any) {
      showFlash(key, err?.message || 'Could not update.');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (item: WhatsAppQueueItem) => {
    setBusy(item.dir);
    try {
      await cancelWhatsApp(item.dir);
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-10 p-5 bg-stone-900/40 rounded-3xl border border-stone-800">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-stone-400">
            <WhatsAppIcon className="w-4 h-4 text-[#25D366]" /> WhatsApp Channel
          </h2>
          <p className="text-xs text-stone-500 mt-1 max-w-prose">
            Posters are scheduled for each verse's date along with the other channels. WhatsApp has no posting
            API for Channels, so when one is due it appears here - share it, or copy the image and caption into
            the Channel - then mark it posted.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {queue && (
            <a
              href={queue.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <WhatsAppIcon className="w-3.5 h-3.5" /> Open channel
            </a>
          )}
          {typeof Notification !== 'undefined' && !notifyOn && (
            <button
              type="button"
              onClick={enableNotifications}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium rounded-lg transition-colors"
            >
              <Bell className="w-3.5 h-3.5" /> Notify me
            </button>
          )}
          <button
            type="button"
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 text-xs font-medium rounded-lg transition-colors"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400">{error}</div>}

      {queue && queue.due.length === 0 && (
        <p className="mt-4 text-xs text-stone-500">Nothing due right now.</p>
      )}

      {queue && queue.due.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">Due now</h3>
          {queue.due.map((item) => (
            <div key={item.dir} className="p-3 bg-stone-950/50 rounded-xl border border-emerald-700/40">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-stone-200">{item.reference}</span>
                <span className="text-[11px] text-stone-500">{formatWhen(item.at)}</span>
              </div>
              <div className="mt-2 space-y-3">
                {item.posters.map((poster) => {
                  const key = `${item.dir}/${poster.file}`;
                  return (
                    <div key={poster.file} className="flex gap-3">
                      <img
                        src={libraryFileUrl(item.dir, poster.file)}
                        alt={poster.label}
                        loading="lazy"
                        className={`w-16 h-28 object-cover rounded-md border border-stone-700 bg-stone-900 flex-shrink-0 ${poster.postedAt ? 'opacity-40' : ''}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] text-stone-400">{poster.label}</div>
                        {poster.caption && (
                          <p className="mt-1 text-[11px] text-stone-500 whitespace-pre-line line-clamp-4">{poster.caption}</p>
                        )}
                        {poster.postedAt ? (
                          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Posted {formatWhen(poster.postedAt)}
                          </p>
                        ) : (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <WhatsAppPostButton
                              dir={item.dir}
                              file={poster.file}
                              reference={item.reference}
                              caption={poster.caption}
                              channelUrl={queue?.channelUrl}
                            />
                            <button type="button" onClick={() => copyImage(item, poster)} className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-medium rounded-lg transition-colors">
                              <ImageIcon className="w-3 h-3" /> Copy image
                            </button>
                            {poster.caption && (
                              <button type="button" onClick={() => copyCaption(key, poster.caption!)} className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-medium rounded-lg transition-colors">
                                <Copy className="w-3 h-3" /> Copy caption
                              </button>
                            )}
                            <a
                              href={libraryFileUrl(item.dir, poster.file)}
                              download={`${item.reference.replace(/\s+/g, '-')}-${poster.file}`}
                              className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-[11px] font-medium rounded-lg transition-colors"
                            >
                              <Download className="w-3 h-3" /> Download
                            </a>
                            <button
                              type="button"
                              onClick={() => markPosted(item, poster.file)}
                              disabled={busy === key}
                              className="flex items-center gap-1 px-2 py-1 bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-emerald-300 text-[11px] font-medium rounded-lg transition-colors"
                            >
                              {busy === key ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Mark posted
                            </button>
                          </div>
                        )}
                        {flash[key] && <p className="mt-1 text-[11px] text-stone-400">{flash[key]}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {queue && queue.upcoming.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-500 mb-1.5">Upcoming</h3>
          <ul className="space-y-1.5 text-xs">
            {queue.upcoming.map((item) => (
              <li key={item.dir} className="flex items-center justify-between gap-3 p-2 bg-stone-950/40 rounded-lg border border-stone-800">
                <span className="text-stone-300 truncate">{item.reference} <span className="text-stone-500">· {item.posters.length} poster{item.posters.length === 1 ? '' : 's'}</span></span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-emerald-300">{formatWhen(item.at)}</span>
                  <button type="button" onClick={() => cancel(item)} disabled={busy === item.dir} title="Remove from the WhatsApp schedule" className="text-stone-500 hover:text-red-400">
                    {busy === item.dir ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WhatsAppPanel;
