/************************ imported-audio-decode.test.ts ************************
 *
 * Purpose: Verify that an audio file imported through the ffmpeg.wasm
 *          fallback keeps readable source bytes the session can save and
 *          decode again: the transcoded WAV, not the original file.
 * How: Fake decoders that behave like the browser ones: the native decoder
 *      detaches the buffer it gets and rejects non-WAV bytes, the transcoder
 *      transfers its input (as ffmpeg's writeFile does) and returns a "WAV".
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { decodeImportedAudioBytes, type ImportedAudioDecoders } from "../demo/imported-audio-decode.js";

const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]); // "RIFF…"
const AIFF = new Uint8Array([0x46, 0x4f, 0x52, 0x4d, 9, 9, 9, 9]); // "FORM…"

/** Detach `buffer`, as decodeAudioData and a worker transfer do. */
function detach(buffer: ArrayBuffer): void {
  structuredClone(buffer, { transfer: [buffer] });
}

function fakeDecoders(log: string[] = []): ImportedAudioDecoders<string> {
  return {
    async decode(bytes) {
      const head = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
      detach(bytes);
      if (head !== "RIFF") throw new Error("Unable to decode audio data");
      return `decoded ${head}`;
    },
    async transcodeToWav(bytes) {
      log.push(`transcode ${bytes.byteLength}`);
      detach(bytes.buffer as ArrayBuffer);
      return WAV.slice().buffer;
    },
    onFallback: () => log.push("fallback"),
  };
}

const file = (name: string, type = "") => ({ name, type, lastModified: 1_700_000_000_000 });

test("a natively decoded file keeps its own bytes and name", async () => {
  const bytes = WAV.slice();
  const out = await decodeImportedAudioBytes(file("a.wav", "audio/wav"), bytes, fakeDecoders());
  assert.equal(out.transcoded, false);
  assert.equal(out.buffer, "decoded RIFF");
  assert.equal(out.source.fileName, "a.wav");
  assert.equal(out.source.mimeType, "audio/wav");
  assert.deepEqual([...out.source.bytes], [...WAV]);
});

test("a file read by ffmpeg keeps readable bytes after the transfer to the worker", async () => {
  const bytes = AIFF.slice();
  const log: string[] = [];
  const out = await decodeImportedAudioBytes(file("tone.aiff"), bytes, fakeDecoders(log));
  assert.deepEqual(log, ["fallback", `transcode ${AIFF.byteLength}`]);
  assert.equal(out.transcoded, true);
  assert.equal(out.source.bytes.byteLength, WAV.byteLength, "source bytes not detached");
  assert.equal(bytes.byteLength, AIFF.byteLength, "the caller's bytes are not detached either");
});

test("a file read by ffmpeg is kept as the WAV the session can decode again", async () => {
  const out = await decodeImportedAudioBytes(file("My Take.aif"), AIFF.slice(), fakeDecoders());
  assert.equal(out.source.fileName, "My Take.wav");
  assert.equal(out.source.mimeType, "audio/wav");
  assert.equal(out.source.lastModified, 1_700_000_000_000);
  assert.deepEqual([...out.source.bytes], [...WAV]);
  // What a session load does with the saved bytes: decode them natively.
  assert.equal(await fakeDecoders().decode(out.source.bytes.slice().buffer), "decoded RIFF");
});

test("a file neither decoder reads is rejected", async () => {
  const decoders = { ...fakeDecoders(), transcodeToWav: async () => { throw new Error("ffmpeg exited with code 1"); } };
  await assert.rejects(decodeImportedAudioBytes(file("x.bin"), AIFF.slice(), decoders), /ffmpeg exited/);
});
