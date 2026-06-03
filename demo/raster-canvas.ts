/******************************** raster-canvas.ts ******************************
 *
 * Purpose: Provide device-pixel-ratio-aware 2D canvas context preparation.
 * How: Wrap the standard canvas sizing and context acquisition behind helpers
 *      that handle DPR scaling, backing-store resizing, and optional clearing.
 *
 * @invariant: returned contexts always operate in CSS-pixel coordinates
 *             (the DPR transform is pre-applied).
 *
 ******************************************************************************/

// Purpose: Resize any raster canvas to the requested CSS size and backing-store size.
// How: Apply CSS width/height, multiply the internal bitmap by devicePixelRatio, then return a 2D context configured in CSS-pixel coordinates.
export function getRasterCanvasContext(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
  clear: boolean,
): CanvasRenderingContext2D | null {
  const roundedWidthPx = Math.max(1, Math.round(widthPx));
  const roundedHeightPx = Math.max(1, Math.round(heightPx));
  const devicePixelRatio = window.devicePixelRatio || 1;
  const backingWidth = Math.max(1, Math.round(roundedWidthPx * devicePixelRatio));
  const backingHeight = Math.max(1, Math.round(roundedHeightPx * devicePixelRatio));

  canvas.style.width = `${roundedWidthPx}px`;
  canvas.style.height = `${roundedHeightPx}px`;
  if (canvas.width !== backingWidth) {
    canvas.width = backingWidth;
  }
  if (canvas.height !== backingHeight) {
    canvas.height = backingHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  if (clear) {
    context.clearRect(0, 0, roundedWidthPx, roundedHeightPx);
  }
  return context;
}

// Purpose: Prepare a raster canvas by resizing and clearing it.
// How: Delegate to getRasterCanvasContext with clear=true.
export function prepareRasterCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  return getRasterCanvasContext(canvas, widthPx, heightPx, true);
}

// Purpose: Prepare an offscreen tile canvas whose repeated pattern size must stay in raw CSS pixels.
// How: Use the bitmap size directly without DPR upscaling, because createPattern repeats from the source bitmap dimensions.
export function preparePatternTileCanvas(
  canvas: HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
): CanvasRenderingContext2D | null {
  const roundedWidthPx = Math.max(1, Math.round(widthPx));
  const roundedHeightPx = Math.max(1, Math.round(heightPx));
  canvas.width = roundedWidthPx;
  canvas.height = roundedHeightPx;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, roundedWidthPx, roundedHeightPx);
  return context;
}
