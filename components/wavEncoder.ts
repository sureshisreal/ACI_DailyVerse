function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function wrapPcm16AsWav(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const dataLen = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * blockAlign)
  view.setUint16(32, 2, true); // block align (channels * bitsPerSample / 8)
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  const bytes = new Uint8Array(buffer);
  bytes.set(pcmBytes, 44);
  return bytes;
}

// /api/verse-audio returns raw headerless 16-bit PCM mono @ 24kHz (see server.ts's shared
// narration format, also consumed by /api/align-captions). /api/video/generate's ffmpeg step needs
// a self-describing audio container to auto-detect the format, not headerless samples - this wraps
// the PCM in a standard 44-byte WAV header client-side rather than changing the shared PCM
// convention the caption-alignment endpoint also depends on.
export function pcm16Base64ToWavBase64(pcmBase64: string, sampleRate = 24000): string {
  return bytesToBase64(wrapPcm16AsWav(base64ToBytes(pcmBase64), sampleRate));
}

// Same idea as pcm16Base64ToWavBase64, but for a meditation video: stitches several separate
// /api/verse-audio calls (e.g. the verse reading, then the explanation+prayer reading) into one
// continuous track, with a short silence spliced between each part, before wrapping the result as
// one WAV. All parts must share the same sample rate (they do - every local TTS engine is
// normalized to 24kHz mono, see server.ts).
export function combinePcm16PartsToWavBase64(pcmBase64Parts: string[], silenceSeconds = 1.0, sampleRate = 24000): string {
  const parts = pcmBase64Parts.map(base64ToBytes);
  const silenceBytes = new Uint8Array(Math.round(silenceSeconds * sampleRate) * 2); // 16-bit mono silence is all-zero
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0) + silenceBytes.length * Math.max(0, parts.length - 1);

  const combined = new Uint8Array(totalLen);
  let offset = 0;
  parts.forEach((part, i) => {
    combined.set(part, offset);
    offset += part.length;
    if (i < parts.length - 1) {
      combined.set(silenceBytes, offset);
      offset += silenceBytes.length;
    }
  });

  return bytesToBase64(wrapPcm16AsWav(combined, sampleRate));
}

// Duration in seconds of a raw headerless 16-bit PCM mono clip (server.ts's shared narration
// format) from its base64 length alone, without decoding samples - used to tell the video generator
// where a narration's spoken-verse portion ends when it's been concatenated with more audio that
// has no on-screen text to highlight (see combinePcm16PartsToWavBase64 and its meditation caller).
export function pcm16Base64DurationSeconds(pcmBase64: string, sampleRate = 24000): number {
  return base64ToBytes(pcmBase64).length / 2 / sampleRate;
}

// Converts a data: URL (e.g. /api/video/generate's "data:video/mp4;base64,...") into a blob: URL
// suitable for a <video src> or an <a download> link.
export function dataUrlToBlobUrl(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /data:(.*?);base64/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  return URL.createObjectURL(new Blob([base64ToBytes(base64).buffer as ArrayBuffer], { type: mime }));
}

// Fetches a blob: URL (as produced by dataUrlToBlobUrl/URL.createObjectURL) back into raw bytes -
// used by the "Download All" bundler to pull already-generated posters/videos into a zip without
// re-requesting anything from the server.
export async function blobUrlToBytes(blobUrl: string): Promise<Uint8Array> {
  const res = await fetch(blobUrl);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
