/********************************* dev-flags.ts *******************************
 *
 * Purpose: Group the boolean developer/debug flags the demo exposes for
 *          inspecting render and perf behaviour. Read by perf.ts (all
 *          three), timeline-scene.ts, ruler-gesture.ts, timeline-debug.ts,
 *          waveform-painter.ts.
 * How: Pure type. All flags default to false; they are toggled from
 *      developer shortcuts in interactions.ts.
 *
 ******************************************************************************/

export type DevFlags = {
  /** Emit per-frame perf counters to the render log. */
  perfLogging: boolean;
  /** During ruler pan, skip geometry rebuild and only translate the buffered content. */
  freezeGeometryDuringPan: boolean;
  /** Use the CPU waveform renderer instead of the GPU path (diagnostic). */
  disableGpuWaveform: boolean;
};

export function createInitialDevFlags(): DevFlags {
  return {
    perfLogging: false,
    freezeGeometryDuringPan: false,
    disableGpuWaveform: false,
  };
}
