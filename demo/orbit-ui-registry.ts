/****************************** orbit-ui-registry.ts ***************************
 *
 * Purpose: Minimal global registry that lets cross-cutting modules (Cmd+Z
 *          router, broadcast handlers, …) locate the OrbitUI wrapper
 *          instance attached to a given effect, without importing the
 *          panel module that owns it.
 * How: A `Map<effectId, OrbitUI>`. The panel registers an entry on
 *      construction and unregisters on teardown. Consumers query by
 *      `effectId` and receive `undefined` for legacy effects (fx-chain
 *      panel still uses the bare FaustOrbitUI + custom PresetOverlay
 *      path until that panel is migrated).
 *
 * Out of scope: This registry has nothing to do with audio routing or
 *          state ownership ; it is a pure pointer table.
 *
 ******************************************************************************/

import type { OrbitUI } from "faust-orbit-ui";

const orbits = new Map<string, OrbitUI>();

export function registerOrbitUI(effectId: string, orbit: OrbitUI): void {
  orbits.set(effectId, orbit);
}

export function unregisterOrbitUI(effectId: string): void {
  orbits.delete(effectId);
}

export function getOrbitUI(effectId: string): OrbitUI | undefined {
  return orbits.get(effectId);
}
