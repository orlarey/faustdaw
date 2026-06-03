/******************************* clip-display-name.ts **************************
 *
 * Purpose: Resolve the human-readable name of a clip for UI surfaces
 *          (rename prompt, context menu label, etc.).
 * How: Prefer the explicit `clip.name` when set. Otherwise fall back to the
 *      linked source session name for clips that came from a session render,
 *      then to the raw resource id.
 *
 ******************************************************************************/
import type { Clip } from "../src/domain/clip.js";
import { getSessionRenderResourceLink } from "./session-render-resource-link.js";

export function getClipDisplayName(clip: Clip): string {
  const explicitName = clip.name?.trim();
  if (explicitName) {
    return explicitName;
  }
  const sessionRender = getSessionRenderResourceLink(clip.resource.id);
  return sessionRender?.sourceSessionName ?? clip.resource.id;
}
