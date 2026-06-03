/**
 * Purpose: AudioResource concept — the imported audio asset record plus
 *          the operations that bring it into a project, look it up, and
 *          validate its structure.
 * How: Expose a minimal immutable-shaped interface that stores the
 *      resource identity and its observable audio dimensions, alongside
 *      the pure functions that import, resolve, and assert-valid the
 *      resource. Operations that mutate a Project call
 *      `assertValidProject` from project.ts as a post-check.
 */
import type { ResourceId } from "./identifiers.js";
import type { Project } from "./project.js";
import { assertValidProject } from "./project.js";

/**
 * Purpose: Represent one imported audio resource available to the project timeline.
 * How: Store a stable resource identifier together with the sample rate, channel count, and total length in source samples.
 */
export type AudioResource = {
  id: ResourceId;
  sampleRate: number;
  channels: number;
  length: number;
}

/**
 * Purpose: Add a new immutable audio resource to the project model.
 * How: Reject duplicate identifiers and invalid audio descriptors, then clone the resource map with the new entry.
 */
export function importAudioResource(project: Project, resource: AudioResource): Project {
  if (project.resources.has(resource.id)) {
    throw new Error(`Precondition violation: resource "${resource.id}" already exists`);
  }

  assertValidAudioResource(resource);

  const next: Project = {
    ...project,
    resources: new Map(project.resources).set(resource.id, resource),
  };
  assertValidProject(next);
  return next;
}

/**
 * Purpose: Recover the audio resource referenced by a clip so semantic functions can operate on it.
 * How: Look up the resource in the project map and throw if the project is not internally consistent.
 */
export function getResource(project: Project, resourceId: ResourceId): AudioResource {
  const resource = project.resources.get(resourceId);
  if (!resource) {
    throw new Error(`Invariant violation: missing resource "${resourceId}"`);
  }

  return resource;
}

/**
 * Purpose: Enforce the validity constraints of a raw imported audio resource before it enters the project.
 * How: Check identifier presence and ensure sample rate, channel count, and frame length are within the permitted numeric domain.
 */
export function assertValidAudioResource(resource: AudioResource): void {
  if (!resource.id) {
    throw new Error("Precondition violation: resource id must be non-empty");
  }

  if (!Number.isInteger(resource.sampleRate) || resource.sampleRate <= 0) {
    throw new Error("Precondition violation: sampleRate must be a positive integer");
  }

  if (!Number.isInteger(resource.channels) || resource.channels <= 0) {
    throw new Error("Precondition violation: channels must be a positive integer");
  }

  if (!Number.isInteger(resource.length) || resource.length < 0) {
    throw new Error("Precondition violation: length must be a non-negative integer");
  }
}
