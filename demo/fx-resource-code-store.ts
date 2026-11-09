/************************** fx-resource-code-store.ts **************************
 *
 * Purpose: Remember the Faust code of every FX resource seen in the current
 *          session, so undo/redo and a reload can restore a resource that the
 *          current project no longer holds.
 * How: FX resources are immutable: within one session an id always names the
 *      same code. `applySessionDocument` rebuilds `project.fxResources` from the
 *      target document's catalog, so an undo drops a resource that a later redo
 *      needs again; its code then only survives here. The store is reset with
 *      the archive's resources when a session is loaded (ids `fxr-N` repeat
 *      across sessions), new ids avoid the ones it knows, and the entries the
 *      undo/redo stacks reference are saved with the working session.
 *
 ******************************************************************************/
import type { Project } from "../src/domain/project.js";
import type { SessionArchiveFxResource } from "./session-archive.js";
import type { SessionDocument } from "./session-document.js";

const codeById = new Map<string, string>();

/**
 * Purpose: Record the code of FX resources (e.g. the project's, before an undo/redo replaces it).
 * How: Store each non-empty code by id; an empty code never overwrites a known one.
 */
export function rememberFxResources(resources: Iterable<{ id: string; code: string }>): void {
  for (const resource of resources) {
    if (resource.code) {
      codeById.set(resource.id, resource.code);
    }
  }
}

/**
 * Purpose: Start the store of a newly loaded session.
 * How: Forget everything, then remember the loaded archive's resources.
 */
export function resetFxResourceCodeStore(resources: Iterable<{ id: string; code: string }> = []): void {
  codeById.clear();
  rememberFxResources(resources);
}

/** The code of every FX resource known in this session, by id (for `applySessionDocument`). */
export function getFxResourceCodeStore(): ReadonlyMap<string, string> {
  return codeById;
}

/** True iff `id` names an FX resource of this session, present in the project or only in its history. */
export function isFxResourceIdKnown(id: string): boolean {
  return codeById.has(id);
}

/**
 * Purpose: Archive payloads for the FX resources the undo/redo stacks need but the project lacks.
 * How: Walk the documents' catalogs, keep the ids absent from `project` whose code is known, once each.
 */
export function collectHistoryFxResourcePayloads(
  project: Project,
  documents: readonly SessionDocument[],
): SessionArchiveFxResource[] {
  const payloads = new Map<string, SessionArchiveFxResource>();
  for (const document of documents) {
    for (const resource of document.fxResources ?? []) {
      if (project.fxResources.has(resource.id) || payloads.has(resource.id)) {
        continue;
      }
      const code = codeById.get(resource.id);
      if (code !== undefined) {
        payloads.set(resource.id, { fxResourceId: resource.id, fileName: `${resource.name}.dsp`, code });
      }
    }
  }
  return [...payloads.values()];
}
