/**
 * Purpose: Represent a stable, ordered, project-bound set of selected clip ids.
 * How: Wrap a frozen list of clip ids together with the Project snapshot they
 *      belong to, expose immutable mutation methods, and cache bounding boxes
 *      lazily since both the project and the id list are immutable.
 *
 * Design notes:
 *   - Selection is bound to a single Project snapshot. All query methods
 *     (clips(), timeRange(), trackRange()) read from that snapshot; there is
 *     no silent rebase when the project changes. To follow a project
 *     transformation, call `selection.rebase(newProject)` explicitly, or
 *     rebuild via `Selection.of(newProject, ids)`.
 *   - The class is immutable. Mutation methods (`add`, `remove`, `toggle`,
 *     `clear`, `withClipIds`) return a new instance; the internal list is
 *     never mutated in place.
 *   - Ordering: clipIds follow the visual order of the bound project —
 *     tracks in timeline order, clips in each track's order. `Selection.of`
 *     normalizes any input to this order and filters orphan ids.
 */
import type { Clip } from "../clip.js";
import type { ClipId } from "../identifiers.js";
import type { Project } from "../project.js";
import type { TimeCoord } from "../timebase.js";
import { clipEnd } from "../clip.js";

/** Inclusive integer range of timeline track indices touched by a Selection. */
export type SelectionTrackRange = {
  readonly minIndex: number;
  readonly maxIndex: number;
}

/** Half-open TimeCoord interval covered by a Selection, in the bound project. */
export type SelectionTimeRange = {
  readonly startCoord: TimeCoord;
  readonly endCoord: TimeCoord;
}

export class Selection {
  /**
   * Purpose: Lazily cache the time bounding box of the selection.
   * How: Computed on first call to `timeRange()`; safe because both
   *      `_project` and `_clipIds` are immutable for the lifetime of
   *      this instance.
   */
  private _timeRange: SelectionTimeRange | null | undefined = undefined;
  private _trackRange: SelectionTrackRange | null | undefined = undefined;

  /**
   * Purpose: Construct a Selection with already-normalized ids.
   * How: Kept private so invariants (order, dedup, coherence) are only
   *      established through `of` / `empty` / mutation methods.
   */
  private constructor(
    private readonly _project: Project,
    private readonly _clipIds: readonly ClipId[],
  ) {}

  // ─── Construction ────────────────────────────────────────────────

  /**
   * Purpose: Return an empty Selection bound to `project`.
   * How: Forward to the private constructor with an empty frozen list.
   */
  static empty(project: Project): Selection {
    return new Selection(project, EMPTY_CLIP_IDS);
  }

  /**
   * Purpose: Build a Selection from any iterable of ids.
   * How: Scan the project's tracks in visual order, keep the clips whose
   *      ids appear in the input set, and drop orphans and duplicates.
   */
  static of(project: Project, clipIds: Iterable<ClipId>): Selection {
    const wanted = clipIds instanceof Set ? clipIds : new Set(clipIds);
    if (wanted.size === 0) {
      return Selection.empty(project);
    }

    const ordered: ClipId[] = [];
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (wanted.has(clip.id)) {
          ordered.push(clip.id);
        }
      }
    }

    if (ordered.length === 0) {
      return Selection.empty(project);
    }

    return new Selection(project, Object.freeze(ordered));
  }

  // ─── Mutation (immutable) ───────────────────────────────────────

  /**
   * Purpose: Return a new Selection containing `clipId`, no-op if already present.
   * How: Delegate to `Selection.of` with the existing ids plus the new one so
   *      the visual order and orphan filtering stay consistent.
   */
  add(clipId: ClipId): Selection {
    if (this.contains(clipId)) {
      return this;
    }
    return Selection.of(this._project, [...this._clipIds, clipId]);
  }

  /**
   * Purpose: Return a new Selection without `clipId`, no-op if absent.
   * How: Filter the internal list; preserves order by construction.
   */
  remove(clipId: ClipId): Selection {
    if (!this.contains(clipId)) {
      return this;
    }
    const next = this._clipIds.filter((id) => id !== clipId);
    if (next.length === 0) {
      return Selection.empty(this._project);
    }
    return new Selection(this._project, Object.freeze(next));
  }

  /**
   * Purpose: Add `clipId` if absent, remove it if present.
   * How: Delegate to `add` / `remove` so normalization happens in one place.
   */
  toggle(clipId: ClipId): Selection {
    return this.contains(clipId) ? this.remove(clipId) : this.add(clipId);
  }

  /**
   * Purpose: Return an empty Selection bound to the same project.
   * How: Forward to `Selection.empty` with the current project.
   */
  clear(): Selection {
    if (this._clipIds.length === 0) {
      return this;
    }
    return Selection.empty(this._project);
  }

  /**
   * Purpose: Replace the entire content by `clipIds`, re-normalized.
   * How: Forward to `Selection.of` so filtering and ordering are applied.
   */
  withClipIds(clipIds: Iterable<ClipId>): Selection {
    return Selection.of(this._project, clipIds);
  }

  // ─── Introspection ──────────────────────────────────────────────

  /** Project snapshot this selection is bound to. */
  get project(): Project {
    return this._project;
  }

  /** Ordered, frozen list of selected clip ids. */
  get clipIds(): readonly ClipId[] {
    return this._clipIds;
  }

  /** Number of clips in the selection. */
  get size(): number {
    return this._clipIds.length;
  }

  /** True when the selection contains no clips. */
  get isEmpty(): boolean {
    return this._clipIds.length === 0;
  }

  /**
   * Purpose: Primary clip id used as drag anchor / context-menu target.
   * How: Return the first id in visual order, or null for empty selections.
   */
  get primaryClipId(): ClipId | null {
    return this._clipIds[0] ?? null;
  }

  /** True when `clipId` is in the selection. */
  contains(clipId: ClipId): boolean {
    return this._clipIds.includes(clipId);
  }

  /**
   * Purpose: Resolve each selected id to its `Clip` record in the bound project.
   * How: Walk the tracks once, collecting clips whose ids are in the selection,
   *      preserving the selection's visual order.
   */
  clips(): readonly Clip[] {
    if (this._clipIds.length === 0) {
      return EMPTY_CLIPS;
    }
    const selected = new Set(this._clipIds);
    const resolved: Clip[] = [];
    for (const track of this._project.timeline.tracks) {
      for (const clip of track.clips) {
        if (selected.has(clip.id)) {
          resolved.push(clip);
        }
      }
    }
    return resolved;
  }

  /** Iterate directly over the selected clip ids in visual order. */
  [Symbol.iterator](): IterableIterator<ClipId> {
    return this._clipIds[Symbol.iterator]();
  }

  // ─── Bounding boxes ─────────────────────────────────────────────

  /**
   * Purpose: Half-open TimeCoord interval covered by the selection.
   * How: Fold `clip.start` (min) and `clipEnd(project, clip)` (max) over
   *      the resolved clips. Null when the selection is empty. Memoized
   *      for the lifetime of the instance.
   */
  timeRange(): SelectionTimeRange | null {
    if (this._timeRange !== undefined) {
      return this._timeRange;
    }
    if (this._clipIds.length === 0) {
      this._timeRange = null;
      return null;
    }
    const clips = this.clips();
    let startCoord = clips[0]!.start;
    let endCoord = clipEnd(this._project, clips[0]!);
    for (let i = 1; i < clips.length; i++) {
      const clip = clips[i]!;
      if (clip.start < startCoord) startCoord = clip.start;
      const end = clipEnd(this._project, clip);
      if (end > endCoord) endCoord = end;
    }
    this._timeRange = { startCoord, endCoord };
    return this._timeRange;
  }

  /**
   * Purpose: Inclusive range of timeline track indices touched by the selection.
   * How: Scan the project tracks, marking the min/max index of tracks that
   *      contain at least one selected clip. Null when the selection is empty.
   *      Memoized like `timeRange()`.
   */
  trackRange(): SelectionTrackRange | null {
    if (this._trackRange !== undefined) {
      return this._trackRange;
    }
    if (this._clipIds.length === 0) {
      this._trackRange = null;
      return null;
    }
    const selected = new Set(this._clipIds);
    let minIndex = -1;
    let maxIndex = -1;
    const tracks = this._project.timeline.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      let hit = false;
      for (const clip of track.clips) {
        if (selected.has(clip.id)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (minIndex === -1) minIndex = i;
        maxIndex = i;
      }
    }
    this._trackRange = { minIndex, maxIndex };
    return this._trackRange;
  }

  // ─── Rebase ─────────────────────────────────────────────────────

  /**
   * Purpose: Reattach the selection to a new project snapshot.
   * How: Filter out clip ids that no longer exist in `project`, and re-apply
   *      the visual ordering of the new project. Used by SelectionOperation
   *      implementations to build their result without reconstructing an id
   *      set manually. UI callers that already hold a raw id set should use
   *      `Selection.of(project, ids)` instead.
   */
  rebase(project: Project): Selection {
    if (project === this._project) {
      return this;
    }
    return Selection.of(project, this._clipIds);
  }
}

const EMPTY_CLIP_IDS: readonly ClipId[] = Object.freeze([]);
const EMPTY_CLIPS: readonly Clip[] = Object.freeze([]);
