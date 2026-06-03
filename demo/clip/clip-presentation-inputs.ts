/************************ clip/clip-presentation-inputs.ts ************************
 *
 * Purpose: Define and capture the ClipPresentationInputs snapshot consumed by clip rendering.
 * How: Declare the named group of non-geometric inputs, bridge the mutable demo-state slices
 *      at render and interaction boundaries, and provide one empty value for tests that only
 *      exercise clip geometry.
 *
 ******************************************************************************/
import type { ClipOnsetAnnotation } from "../onsets.js";
import type { SessionRenderResourceLink } from "../session-archive.js";
import { demoState, type ImportedResourceSource } from "../state.js";
import type { ClipOnsetEditorState } from "../onsets.js";

// Purpose: Bundle the non-geometric inputs needed to resolve one clip's presentation.
// How: Collect the session-link, onset-annotation, resource-availability, and selection
//      lookups consumed together by resolveClipRenderPresentation so every render caller
//      threads them as one named group instead of each site reading global state.
export type ClipPresentationInputs = {
  selectedClipIds: ReadonlySet<string>;
  sessionRenderResources: ReadonlyMap<string, SessionRenderResourceLink>;
  workspaceSessions: ReadonlyMap<string, { sessionName: string; sessionRevision: string | null }>;
  clipOnsetEditorState: ClipOnsetEditorState | null;
  clipOnsetAnnotations: ReadonlyMap<string, ClipOnsetAnnotation>;
  resourceSourceFiles: ReadonlyMap<string, ImportedResourceSource>;
  resourceAudioBuffers: ReadonlyMap<string, AudioBuffer>;
  playbackClipFilter: ReadonlySet<string> | null;
  transformPreviewClipId: string | null;
};

// Purpose: Capture the current ClipPresentationInputs from the mutable demo state.
// How: Reference the live demo-state collections directly so callers thread one named
//      group of inputs through the render and hit-test pipelines.
export function captureClipPresentationInputs(): ClipPresentationInputs {
  return {
    selectedClipIds: demoState.selection.ids,
    sessionRenderResources: demoState.resources.sessionRenders,
    workspaceSessions: demoState.workspaceSessions,
    clipOnsetEditorState: demoState.clipOnsetEditorState,
    clipOnsetAnnotations: demoState.clipOnsetAnnotations,
    resourceSourceFiles: demoState.resources.sourceFiles,
    resourceAudioBuffers: demoState.resources.audioBuffers,
    playbackClipFilter: demoState.playSelection.clipFilter,
    transformPreviewClipId: demoState.faustTransformPreview?.clipId ?? null,
  };
}

// Purpose: Provide one empty ClipPresentationInputs value for tests that only exercise
//          clip geometry and do not depend on selection, onset, or session-linked flags.
// How: Back each lookup with empty readonly collections so every presentation query returns
//      the default "not present" branch.
export const EMPTY_CLIP_PRESENTATION_INPUTS: ClipPresentationInputs = {
  selectedClipIds: new Set<string>(),
  sessionRenderResources: new Map(),
  workspaceSessions: new Map(),
  clipOnsetEditorState: null,
  clipOnsetAnnotations: new Map(),
  resourceSourceFiles: new Map(),
  resourceAudioBuffers: new Map(),
  playbackClipFilter: null,
  transformPreviewClipId: null,
};
