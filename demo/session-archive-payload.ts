/**************************** session-archive-payload.ts *********************
 *
 * Purpose: Build the resource/fx payloads that accompany a session archive.
 *          Gathers bytes from the live demoState (source files, decoded audio
 *          buffers, FX code) and produces the array shapes that
 *          `buildSessionArchiveBytes` expects. Also offers the symmetric
 *          load-side helper `buildFxResourceCodeMap` and the "build the full
 *          current archive bytes in one call" convenience.
 * How: Pure gathering from demoState — no DOM, no IO, no UI. Depends on
 *      session-archive.ts for the underlying serialization and on
 *      session-history.ts for the current session document snapshot.
 *
 ******************************************************************************/
import type { Project } from "../src/domain/project.js";
import { demoState } from "./state.js";
import type { SessionDocument } from "./session-document.js";
import { createCurrentSessionDocument } from "./session-history.js";
import {
  audioBufferToFloatWavBytes,
  buildSessionArchiveBytes,
  type SessionArchiveFxResource,
  type SessionRenderResourceLink,
} from "./session-archive.js";

/**
 * Purpose: Shape of the "resource payload" that a session archive embeds for
 *          one audio resource — used both by build and apply paths.
 */
export type ArchiveResourcePayload = {
  resourceId: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  fileBytes: Uint8Array;
  sessionRender: SessionRenderResourceLink | null;
};

/**
 * Purpose: List the resource ids referenced by any clip in the given session document.
 * How: Walk every track/clip and collect unique resource ids.
 */
export function collectUsedSessionResourceIds(sessionDocument: SessionDocument): string[] {
  const usedResourceIds = new Set<string>();
  for (const track of sessionDocument.tracks) {
    for (const clip of track.clips) {
      usedResourceIds.add(clip.resourceId);
    }
  }
  return [...usedResourceIds];
}

/**
 * Purpose: Collect the FX (.dsp) payloads for every fxResource attached to the project.
 * How: Map over project.fxResources producing the archive shape.
 */
export function collectFxResourcePayloads(project: Project): SessionArchiveFxResource[] {
  return Array.from(project.fxResources.values()).map((r) => ({
    fxResourceId: r.id,
    fileName: `${r.name}.dsp`,
    code: r.code,
  }));
}

/**
 * Purpose: Build an archive payload for a single resource by id, pulling the
 *          original source bytes when available, or rendering the decoded buffer
 *          to WAV as a fallback.
 * How: Prefer demoState.resources.sourceFiles (exact bytes of the original file);
 *      otherwise fall back to demoState.resources.audioBuffers encoded as WAV.
 *      Throws when neither is available.
 */
export function getArchiveResourcePayload(resourceId: string): ArchiveResourcePayload {
  const sessionRender = demoState.resources.sessionRenders.get(resourceId) ?? null;
  const sourceFile = demoState.resources.sourceFiles.get(resourceId);
  if (sourceFile) {
    return {
      resourceId,
      fileName: sourceFile.fileName,
      mimeType: sourceFile.mimeType,
      lastModified: sourceFile.lastModified,
      fileBytes: sourceFile.bytes,
      sessionRender,
    };
  }
  const audioBuffer = demoState.resources.audioBuffers.get(resourceId);
  if (!audioBuffer) {
    throw new Error(`Session resource "${resourceId}" has no available source payload`);
  }
  return {
    resourceId,
    fileName: `${resourceId}.wav`,
    mimeType: "audio/wav",
    lastModified: 0,
    // No source bytes: encode the buffer losslessly (float WAV).
    fileBytes: audioBufferToFloatWavBytes(audioBuffer),
    sessionRender,
  };
}

/**
 * Purpose: Build payloads for the union of (a) ids explicitly marked retained
 *          and (b) ids referenced by the current session document. Used by the
 *          autosave path so stale-but-retained resources survive a round-trip.
 */
export function buildRetainedSessionResourcePayloads(): ArchiveResourcePayload[] {
  const currentSessionDocument = createCurrentSessionDocument();
  const retainedResourceIds = new Set([
    ...demoState.resources.retainedIds,
    ...collectUsedSessionResourceIds(currentSessionDocument),
  ]);
  return [...retainedResourceIds].map((resourceId) => getArchiveResourcePayload(resourceId));
}

/**
 * Purpose: Serialize the current project state to archive bytes in one call.
 * How: Snapshot the session document, gather payloads for used resources and
 *      FX, and hand them to `buildSessionArchiveBytes`.
 */
export function buildCurrentSessionArchiveBytes(): Uint8Array {
  const sessionDocument = createCurrentSessionDocument();
  const usedResourceIds = collectUsedSessionResourceIds(sessionDocument);
  return buildSessionArchiveBytes(
    sessionDocument,
    usedResourceIds.map((resourceId) => getArchiveResourcePayload(resourceId)),
    collectFxResourcePayloads(demoState.project),
  );
}

/**
 * Purpose: Index FX payloads by id so `applySessionDocument` can look up code
 *          when applying a loaded archive.
 */
export function buildFxResourceCodeMap(
  fxResources: readonly SessionArchiveFxResource[],
): Map<string, string> {
  return new Map(fxResources.map((fx) => [fx.fxResourceId, fx.code]));
}
