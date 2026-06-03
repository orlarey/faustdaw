/****************************** fx-panel-reorder.ts ***************************
 *
 * Purpose: Drop-position computation for the FX / Transform panel
 *          drag-and-drop reorder. The list is laid out horizontally
 *          (`flex-direction: row`), so we project the cursor's X
 *          coordinate onto the centers of the static effects to
 *          decide where the dragged effect should land — including
 *          the « after the last » slot, which the previous Y-based
 *          logic could not address.
 * How: `computeInsertIndex` returns a post-removal index in [0, n]
 *      where n is the number of *non-dragged* effects in the list
 *      (so it can be passed straight to `moveEffect` without the
 *      from-vs-to bookkeeping that the older code did). The visual
 *      indicator is rendered by `showReorderInsertion`, which marks
 *      one neighbour with the existing `drop-before` / `drop-after`
 *      classes — the trailing slot reuses `drop-after` on the last
 *      effect so the CSS only needs the two states.
 *
 ******************************************************************************/

const EFFECT_SELECTOR = ".fx-panel-effect";
const DROP_BEFORE = "fx-panel-effect--drop-before";
const DROP_AFTER = "fx-panel-effect--drop-after";

/**
 * Purpose: Compute the post-removal insertion index for a drag.
 * How: Walk the list's effects, skip the dragged one, count those
 *      whose horizontal midpoint sits to the left of `clientX`. The
 *      resulting count is the index where the dragged effect would
 *      land in the list once it has been spliced out — exactly what
 *      `moveEffect` expects.
 */
export function computeInsertIndex(
  list: HTMLElement,
  clientX: number,
  draggedEffectId: string | null,
): number {
  let count = 0;
  for (const el of list.querySelectorAll<HTMLElement>(EFFECT_SELECTOR)) {
    if (el.dataset.effectId === draggedEffectId) continue;
    const rect = el.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    if (clientX >= midX) count++;
  }
  return count;
}

/**
 * Purpose: Render the « will drop here » insertion bar.
 * How: Clear the previous markers, then mark either the effect
 *      currently sitting at `insertIndex` with `drop-before` (a left
 *      bar) or — when the index points past the last effect — the
 *      last effect with `drop-after` (a right bar).
 */
export function showReorderInsertion(
  list: HTMLElement,
  draggedEffectId: string | null,
  insertIndex: number,
): void {
  clearReorderInsertion(list);
  const others: HTMLElement[] = [];
  for (const el of list.querySelectorAll<HTMLElement>(EFFECT_SELECTOR)) {
    if (el.dataset.effectId !== draggedEffectId) others.push(el);
  }
  if (others.length === 0) return;
  if (insertIndex >= others.length) {
    others[others.length - 1]!.classList.add(DROP_AFTER);
  } else {
    others[insertIndex]!.classList.add(DROP_BEFORE);
  }
}

export function clearReorderInsertion(list: HTMLElement): void {
  for (const el of list.querySelectorAll<HTMLElement>(`.${DROP_BEFORE}, .${DROP_AFTER}`)) {
    el.classList.remove(DROP_BEFORE, DROP_AFTER);
  }
}
