/***************************** preset-library-delta.ts ************************
 *
 * Purpose: Compute what an OrbitUI library change actually changed, so the
 *          preset store receives that change and nothing else.
 * How: The preset store (IDB) is shared by every tab of the origin, while
 *      each OrbitUI instance only holds the library it last loaded. Diffing
 *      an instance's snapshot against the store would delete or revert what
 *      another tab wrote since. Instead, diff the snapshot against the
 *      library this instance last synced: records added or changed are
 *      upserted, records it removed are deleted, the rest is left alone.
 *
 ******************************************************************************/

/** The fields of a preset the sync compares and writes. */
export type LibraryPreset = {
  readonly uiHash: string;
  readonly configHash: string;
  readonly configuration: Readonly<Record<string, number>>;
  readonly lastSeenAt: number;
  readonly name?: string;
};

export type LibraryDelta<P extends LibraryPreset> = {
  /** Records added, or whose name / lastSeenAt changed. */
  readonly upserts: readonly P[];
  /** configHashes the instance removed. */
  readonly deletes: readonly string[];
};

/**
 * Purpose: Index a library snapshot of `uiHash` by configHash.
 * How: Records of another uiHash are ignored, as OrbitUI does.
 */
export function indexLibrary<P extends LibraryPreset>(
  records: readonly P[],
  uiHash: string,
): Map<string, P> {
  const map = new Map<string, P>();
  for (const record of records) {
    if (record.uiHash === uiHash) map.set(record.configHash, record);
  }
  return map;
}

/**
 * Purpose: Delta between the library an instance last synced (`previous`)
 *          and its new snapshot (`next`).
 * How: A record is upserted when it is new or its name / lastSeenAt differ
 *      (the configuration is identified by configHash); a configHash present
 *      before and absent now is deleted.
 */
export function computeLibraryDelta<P extends LibraryPreset>(
  previous: ReadonlyMap<string, P>,
  next: ReadonlyMap<string, P>,
): LibraryDelta<P> {
  const upserts: P[] = [];
  for (const [configHash, record] of next) {
    const prev = previous.get(configHash);
    if (!prev || prev.name !== record.name || prev.lastSeenAt !== record.lastSeenAt) {
      upserts.push(record);
    }
  }
  const deletes: string[] = [];
  for (const configHash of previous.keys()) {
    if (!next.has(configHash)) deletes.push(configHash);
  }
  return { upserts, deletes };
}
