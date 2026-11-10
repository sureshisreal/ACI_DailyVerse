import React, { useState } from 'react';
import { Loader2, Copy } from 'lucide-react';
import { getWhatsAppCaption, libraryFileUrl } from '../services/verseApi';

// One-tap "post this poster to the WhatsApp Channel". WhatsApp has no Channel posting API (see
// server/services/whatsapp.service.ts), so this gets the poster as far as it can:
// - where the browser can share files (phones, and Safari/Chrome share sheets) it opens the share
//   sheet with the image + caption - pick WhatsApp, then the Channel;
// - otherwise it copies the image to the clipboard and opens the Channel, leaving a Copy caption
//   button here for the second paste.

export const WhatsAppIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.94.95-3.48-.22-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.2 4.24-9.44 9.45-9.44a9.38 9.38 0 0 1 6.68 2.77 9.38 9.38 0 0 1 2.76 6.68c0 5.21-4.24 9.44-9.45 9.44zm8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.79.7.69 5.8.69 12.06c0 2 .52 3.96 1.52 5.68L.6 23.6l6-1.57a11.33 11.33 0 0 0 5.44 1.39h.01c6.26 0 11.36-5.1 11.36-11.36 0-3.04-1.18-5.89-3.33-8.04z" />
  </svg>
);

interface Props {
  dir: string;
  file: string;
  reference: string;
  // Pass when already known (the queue has it); otherwise it's fetched on click.
  caption?: string | null;
  channelUrl?: string;
  // 'button' = labelled button (queue); 'icon' = small round icon (library thumbnails).
  variant?: 'button' | 'icon';
}

const WhatsAppPostButton: React.FC<Props> = ({ dir, file, reference, caption: knownCaption, channelUrl: knownChannelUrl, variant = 'button' }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pendingCaption, setPendingCaption] = useState<string | null>(null);

  const post = async () => {
    setBusy(true);
    setNote(null);
    setPendingCaption(null);
    try {
      const fetched = knownCaption === undefined || !knownChannelUrl ? await getWhatsAppCaption(dir, file) : null;
      const caption = knownCaption ?? fetched?.caption ?? null;
      const channelUrl = knownChannelUrl ?? fetched?.channelUrl;
      const blob = await (await fetch(libraryFileUrl(dir, file))).blob();
      const image = new File([blob], `${reference.replace(/\s+/g, '-')}-${file}`, { type: 'image/png' });
      const shareData: ShareData = { files: [image], ...(caption ? { text: caption } : {}) };

      if (navigator.canShare?.(shareData)) {
        try {
          await navigator.share(shareData);
          setNote('Shared - mark it posted once it is in the Channel.');
        } catch (err: any) {
          if (err?.name !== 'AbortError') throw err;
        }
        return;
      }

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (channelUrl) window.open(channelUrl, '_blank', 'noopener');
      setPendingCaption(caption);
      setNote('Poster copied - paste it into the Channel, then copy the caption.');
    } catch (err: any) {
      setNote(err?.message || 'Could not prepare the post.');
    } finally {
      setBusy(false);
    }
  };

  const copyCaption = async () => {
    if (!pendingCaption) return;
    try {
      await navigator.clipboard.writeText(pendingCaption);
      setNote('Caption copied - paste it under the poster and send.');
      setPendingCaption(null);
    } catch {
      setNote('Could not copy the caption.');
    }
  };

  return (
    <span className={variant === 'icon' ? 'relative inline-flex flex-col items-center gap-1' : 'inline-flex flex-col gap-1'}>
      <button
        type="button"
        onClick={post}
        disabled={busy}
        title="Post to the WhatsApp Channel"
        className={variant === 'icon'
          ? 'flex items-center justify-center w-6 h-6 rounded-full bg-[#25D366] hover:bg-[#1ebe5b] disabled:opacity-60 text-white shadow transition-colors'
          : 'flex items-center gap-1 px-2.5 py-1 bg-[#25D366] hover:bg-[#1ebe5b] disabled:opacity-60 text-white text-[11px] font-medium rounded-lg transition-colors'}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <WhatsAppIcon className="w-3.5 h-3.5" />}
        {variant === 'button' && 'Post to WhatsApp'}
      </button>
      {pendingCaption && (
        <button
          type="button"
          onClick={copyCaption}
          className="flex items-center gap-1 px-2 py-0.5 bg-stone-800 hover:bg-stone-700 text-stone-200 text-[10px] font-medium rounded-md transition-colors whitespace-nowrap"
        >
          <Copy className="w-3 h-3" /> Copy caption
        </button>
      )}
      {note && (
        <span className={`text-[10px] text-stone-400 leading-tight ${variant === 'icon' ? 'max-w-24 text-center' : ''}`}>{note}</span>
      )}
    </span>
  );
};

export default WhatsAppPostButton;
