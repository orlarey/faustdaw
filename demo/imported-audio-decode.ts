/**************************** imported-audio-decode.ts *************************
 *
 * Purpose: Decode the bytes of an imported audio file, with the ffmpeg.wasm
 *          fallback, and choose the bytes the session keeps as its source
 *          (saved in the archive, autosaved, decoded again on load).
 * How: Try the native decoder on a copy. On failure, transcode a copy to WAV
 *      and decode a copy of the WAV. The source is then that WAV, not the
 *      original file: the native decoder that loads a session cannot read
 *      the original (AIFF, 64-bit float WAV, ...), and the file's own bytes
 *      may be gone, since ffmpeg's writeFile transfers its buffer to the
 *      worker. Every decoder and transcoder receives a copy, so the kept
 *      bytes stay readable whatever the callee transfers or detaches.
 *
 ******************************************************************************/
import type { ImportedResourceSource } from "./state.js";

/** The file fields a source carries over (a File satisfies it). */
export type ImportedFileInfo = {
  readonly name: string;
  readonly type: string;
  readonly lastModified: number;
};

export type ImportedAudioDecoders<B> = {
  /** Native decode (decodeAudioData); may detach the buffer it gets. */
  readonly decode: (bytes: ArrayBuffer) => Promise<B>;
  /** Transcode to WAV (ffmpeg.wasm); may transfer the bytes it gets. */
  readonly transcodeToWav: (bytes: Uint8Array) => Promise<ArrayBuffer>;
  /** Called once, before the transcode, when the native decode failed. */
  readonly onFallback?: () => void;
};

function stem(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return base || fileName.trim();
}

/**
 * Purpose: Decode `fileBytes` and return the decoded buffer with the source
 *          the session must keep for it.
 * How: Native path: the source is the file itself. Fallback path: the source
 *      is the transcoded WAV, named `<stem>.wav`, typed audio/wav, with the
 *      file's lastModified. A failure of both paths rethrows the transcode
 *      or WAV decode error.
 */
export async function decodeImportedAudioBytes<B>(
  file: ImportedFileInfo,
  fileBytes: Uint8Array,
  decoders: ImportedAudioDecoders<B>,
): Promise<{ buffer: B; source: ImportedResourceSource; transcoded: boolean }> {
  try {
    const buffer = await decoders.decode(fileBytes.slice().buffer);
    return {
      buffer,
      source: { fileName: file.name, mimeType: file.type, lastModified: file.lastModified, bytes: fileBytes },
      transcoded: false,
    };
  } catch {
    decoders.onFallback?.();
  }
  const wavBytes = new Uint8Array(await decoders.transcodeToWav(fileBytes.slice()));
  const buffer = await decoders.decode(wavBytes.slice().buffer);
  return {
    buffer,
    source: { fileName: `${stem(file.name)}.wav`, mimeType: "audio/wav", lastModified: file.lastModified, bytes: wavBytes },
    transcoded: true,
  };
}
