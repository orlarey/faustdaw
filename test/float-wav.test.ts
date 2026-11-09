/******************************** float-wav.test.ts ****************************
 *
 * Purpose: Check that generated audio is persisted without change: values
 *          above full scale and tiny values survive, the header is a valid
 *          32-bit IEEE float WAVE.
 * How: Encode a buffer-like object with audioBufferToFloatWavBytes, parse
 *      the RIFF chunks back, and compare samples bit for bit.
 *
 ******************************************************************************/
import assert from "node:assert/strict";
import test from "node:test";

import { audioBufferToFloatWavBytes, type PcmBufferLike } from "../demo/session-archive.js";

function bufferLike(sampleRate: number, channels: number[][]): PcmBufferLike {
  const data = channels.map((c) => Float32Array.from(c));
  return {
    sampleRate,
    numberOfChannels: data.length,
    length: data[0]!.length,
    getChannelData: (index: number) => data[index]!,
  } as PcmBufferLike;
}

function readChunks(bytes: Uint8Array): Map<string, DataView> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  assert.equal(ascii(0), "RIFF");
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(ascii(8), "WAVE");
  const chunks = new Map<string, DataView>();
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    chunks.set(ascii(at), new DataView(bytes.buffer, bytes.byteOffset + at + 8, size));
    at += 8 + size + (size % 2);
  }
  assert.equal(at, bytes.length);
  return chunks;
}

test("header describes 32-bit IEEE float with fact chunk", () => {
  const chunks = readChunks(audioBufferToFloatWavBytes(bufferLike(44100, [[0, 0.5, -0.5], [1, 2, 3]])));
  const fmt = chunks.get("fmt ")!;
  assert.equal(fmt.byteLength, 18);
  assert.equal(fmt.getUint16(0, true), 3); // WAVE_FORMAT_IEEE_FLOAT
  assert.equal(fmt.getUint16(2, true), 2); // channels
  assert.equal(fmt.getUint32(4, true), 44100);
  assert.equal(fmt.getUint32(8, true), 44100 * 8); // byte rate
  assert.equal(fmt.getUint16(12, true), 8); // block align
  assert.equal(fmt.getUint16(14, true), 32);
  assert.equal(fmt.getUint16(16, true), 0); // cbSize
  assert.equal(chunks.get("fact")!.getUint32(0, true), 3); // frames
  assert.equal(chunks.get("data")!.byteLength, 3 * 8);
});

test("samples above full scale and tiny samples are kept exactly, interleaved", () => {
  const left = [1.5, -2.75, 1e-7, 0.123456789];
  const right = [-1.5, 3, -1e-9, 1];
  const data = readChunks(audioBufferToFloatWavBytes(bufferLike(48000, [left, right]))).get("data")!;
  const decoded: number[][] = [[], []];
  for (let frame = 0; frame < left.length; frame++) {
    decoded[0]!.push(data.getFloat32(frame * 8, true));
    decoded[1]!.push(data.getFloat32(frame * 8 + 4, true));
  }
  assert.deepEqual(decoded[0], Array.from(Float32Array.from(left)));
  assert.deepEqual(decoded[1], Array.from(Float32Array.from(right)));
});

test("non-finite samples are written as 0", () => {
  const data = readChunks(audioBufferToFloatWavBytes(bufferLike(48000, [[NaN, Infinity, -Infinity, 0.25]]))).get("data")!;
  assert.deepEqual([0, 1, 2, 3].map((i) => data.getFloat32(i * 4, true)), [0, 0, 0, 0.25]);
});
