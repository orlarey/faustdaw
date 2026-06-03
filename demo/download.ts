/******************************** download.ts *********************************
 *
 * Purpose: Browser-side download utilities — filename builders for the session
 *          archive, mixdown WAV, and session-render WAV; a blob download
 *          trigger; and the shared project-id slug normalizer the filenames
 *          all share.
 * How: Pure functions (no demoState access). Consumers: realtime-export,
 *      session archive saving, session-render materialization, resource-id
 *      generation when importing a remote session render.
 *
 ******************************************************************************/

/**
 * Purpose: Normalize a project or session id into a conservative ASCII slug.
 * How: Lowercase, replace any non-[a-z0-9] run with a single dash, trim
 *      dashes, and fall back to "session" for empty inputs.
 */
export function getNormalizedProjectIdSlug(projectId: string): string {
  return projectId
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    || "webdaw";
}

/**
 * Purpose: Derive a file name suitable for one downloaded mix.
 * How: Normalize the project id to a conservative ASCII slug and append the WAV suffix.
 */
export function getMixdownFileName(sessionLabel: string): string {
  return `${getNormalizedProjectIdSlug(sessionLabel)}-mixdown.wav`;
}

/**
 * Purpose: Build a compact timestamp (YYYY-MM-DD-HHMMSS) for session archive filenames.
 */
function formatSessionArchiveTimestamp(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

/**
 * Purpose: Derive a file name suitable for a downloaded session archive.
 * How: Slug + timestamp + "session.zip" suffix.
 */
export function getSessionArchiveFileName(sessionLabel: string): string {
  return `${getNormalizedProjectIdSlug(sessionLabel)}-${formatSessionArchiveTimestamp(new Date())}-session.zip`;
}

/**
 * Purpose: Derive a file name suitable for a rendered session audio file.
 * How: Slug + "session-render.wav" suffix.
 */
export function getSessionRenderAudioFileName(sessionName: string): string {
  return `${getNormalizedProjectIdSlug(sessionName)}-session-render.wav`;
}

/**
 * Purpose: Trigger a browser download for one generated blob.
 * How: Allocate a temporary object URL, click an off-DOM anchor, then revoke the URL shortly after.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
