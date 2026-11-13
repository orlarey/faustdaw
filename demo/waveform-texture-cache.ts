/************************** waveform-texture-cache.ts **************************
 *
 * Purpose: Decide when a cached GPU waveform texture must be (re)uploaded.
 *          A resource id names different audio over the life of a tab: a
 *          session loaded after another one, or a file imported again after
 *          an Undo, can bring a resource with an id already seen. Its texture
 *          bank is rebuilt (new `packedMinMax` arrays), but a texture cached
 *          by id alone kept drawing the previous audio.
 * How: One slot per resource id × bucket size, remembering the array it was
 *      uploaded from. The same array reuses the texture; another array is
 *      uploaded into the same texture (no texture is created per change).
 *      Pure over a tiny GPU interface, so the rule is testable without WebGL.
 *
 ******************************************************************************/

/** A cached texture and the min/max array it holds. */
export type WaveformTextureSlot<T> = {
  texture: T;
  source: Float32Array;
};

/** The two GPU calls the cache needs. */
export type WaveformTextureGpu<T> = {
  create(): T | null;
  upload(texture: T, source: Float32Array): void;
};

/**
 * Purpose: Return the texture holding `source` for `key`, uploading only when
 *          the slot is new or was filled from another array.
 * How: Identity of `source` is the content check: the texture bank builds a
 *      new array whenever a resource's audio is (re)published.
 */
export function resolveWaveformTexture<T>(
  slots: Map<string, WaveformTextureSlot<T>>,
  key: string,
  source: Float32Array,
  gpu: WaveformTextureGpu<T>,
): T | null {
  const slot = slots.get(key);
  if (slot) {
    if (slot.source !== source) {
      gpu.upload(slot.texture, source);
      slot.source = source;
    }
    return slot.texture;
  }
  const texture = gpu.create();
  if (texture === null) {
    return null;
  }
  gpu.upload(texture, source);
  slots.set(key, { texture, source });
  return texture;
}
