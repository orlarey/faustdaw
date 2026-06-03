/******************************** clip-raster.ts ********************************
 *
 * Purpose: Draw clip raster blocks and selection borders onto a 2D canvas.
 * How: Reuse `ClipRenderModel` values produced elsewhere, then paint rounded
 *      rectangles and text labels directly into the target raster context.
 *
 *****************************************************************************/
import type { ClipRenderModel } from "./clip-render-model.js";

export type RasterClipBlock = Pick<
  ClipRenderModel,
  | "leftPx"
  | "widthPx"
  | "topPx"
  | "heightPx"
  | "titleText"
  | "metaText"
  | "isSelected"
  | "isDimmed"
  | "isSessionRender"
  | "isSessionRenderLinked"
  | "isSessionRenderStale"
>;

/**
 * Purpose: Trace a rounded rectangle sub-path on a 2D canvas context.
 * How: Move to the top-left arc start, then draw four sides connected by quadratic corner curves.
 */
export function addRoundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const clampedRadius = Math.max(0, Math.min(radius, width * 0.5, height * 0.5));
  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

/**
 * Purpose: Paint filled clip blocks with rounded borders and text labels onto a raster canvas.
 * How: Iterate visible clip models, fill a rounded rect per clip, then overlay title and meta text.
 */
export function drawRasterClipBlocks(context: CanvasRenderingContext2D, models: readonly ClipRenderModel[]): void {
  for (const model of models) {
    drawRasterClipBlock(context, model);
  }
}

export function drawRasterClipBlock(context: CanvasRenderingContext2D, model: RasterClipBlock): void {
  if (model.widthPx <= 0 || model.heightPx <= 0) {
    return;
  }
  const previousAlpha = context.globalAlpha;
  if (model.isDimmed) {
    context.globalAlpha = 0.28;
  }
  const paddingPx = Math.max(2, Math.min(model.widthPx / 10, 14));
  const radiusPx = Math.max(2, Math.min(model.widthPx / 14, 8));
  const fillStyle = model.isSessionRender
    ? !model.isSessionRenderLinked
      ? "rgba(106, 78, 148, 0.80)"
      : model.isSessionRenderStale
      ? "rgba(196, 126, 28, 0.80)"
      : "rgba(34, 121, 196, 0.78)"
    : "rgba(241, 28, 49, 0.74)";
  const borderStyle = model.isSelected
    ? "rgba(86, 215, 255, 0.82)"
    : model.isSessionRender
    ? !model.isSessionRenderLinked
      ? "rgba(210, 188, 255, 0.52)"
      : model.isSessionRenderStale
      ? "rgba(255, 215, 146, 0.54)"
      : "rgba(162, 206, 255, 0.52)"
    : "rgba(255, 181, 168, 0.46)";

  addRoundedRectPath(context, model.leftPx, model.topPx, model.widthPx, model.heightPx, radiusPx);
  context.fillStyle = fillStyle;
  context.fill();
  strokeRasterClipBorder(
    context,
    model.leftPx,
    model.topPx,
    model.widthPx,
    model.heightPx,
    radiusPx,
    borderStyle,
  );

  if (model.widthPx < 28 || model.heightPx < 18) {
    context.globalAlpha = previousAlpha;
    return;
  }

  context.save();
  context.beginPath();
  addRoundedRectPath(context, model.leftPx, model.topPx, model.widthPx, model.heightPx, radiusPx);
  context.clip();

  context.fillStyle = "rgba(255, 255, 255, 0.96)";
  context.font = '650 13px "Space Grotesk", sans-serif';
  context.textBaseline = "top";
  context.fillText(
    model.titleText,
    model.leftPx + paddingPx,
    model.topPx + 3,
    Math.max(model.widthPx - paddingPx * 2, 0),
  );

  if (model.widthPx >= 64 && model.heightPx >= 28) {
    context.fillStyle = "rgba(255, 255, 255, 0.74)";
    context.font = '11px "IBM Plex Mono", monospace';
    context.textBaseline = "alphabetic";
    context.fillText(
      model.metaText,
      model.leftPx + paddingPx,
      model.topPx + model.heightPx - 5,
      Math.max(model.widthPx - paddingPx * 2, 0),
    );
  }
  context.restore();
  context.globalAlpha = previousAlpha;
}

/**
 * Purpose: Draw selection highlight borders on top of already-rendered clip blocks.
 * How: Stroke a rounded-rect border on each selected clip model.
 */
export function drawRasterClipSelectionBorders(context: CanvasRenderingContext2D, models: readonly ClipRenderModel[]): void {
  for (const model of models) {
    if (!model.isSelected || model.widthPx <= 0 || model.heightPx <= 0) {
      continue;
    }
    const radiusPx = Math.max(2, Math.min(model.widthPx / 14, 8));
    const borderColor = model.isTransformTarget
      ? "rgba(180, 100, 255, 0.85)"
      : "rgba(86, 215, 255, 0.82)";
    strokeRasterClipBorder(
      context,
      model.leftPx,
      model.topPx,
      model.widthPx,
      model.heightPx,
      radiusPx,
      borderColor,
    );
  }
}

function strokeRasterClipBorder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
): void {
  const lineWidth = 1;
  const inset = lineWidth * 0.5;
  const strokedWidth = Math.max(width - lineWidth, 0);
  const strokedHeight = Math.max(height - lineWidth, 0);
  if (strokedWidth <= 0 || strokedHeight <= 0) {
    return;
  }
  addRoundedRectPath(
    context,
    x + inset,
    y + inset,
    strokedWidth,
    strokedHeight,
    Math.max(radius - inset, 0),
  );
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.stroke();
}
