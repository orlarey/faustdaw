import {
  type LoadedSessionArchive,
  buildSessionArchiveBytes,
  parseSessionArchive,
  type SessionArchiveResource,
  type SessionArchiveFxResource,
  type SessionRenderResourceLink,
} from "./session-archive.js";
import { computeSessionDocumentRevision, type SessionDocument } from "./session-document.js";
import { areSessionViewStatesEqual, isSessionViewState, type SessionViewState } from "./session-view-state.js";

export type LocalSessionMetadata = {
  sessionId: string;
  sessionName: string;
  sessionRevision: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  writerTabId: string | null;
  writerLeaseExpiresAt: number | null;
  viewLeases: {
    tabId: string;
    expiresAt: number;
  }[];
};

type LegacyWorkingSessionRecord = {
  key: string;
  updatedAt: number;
  archiveBytes: Uint8Array;
  sessionViewState?: SessionViewState | null;
};

type WorkingSessionResourceRef = {
  resourceId: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  resourceKey: string;
  sessionRender: SessionRenderResourceLink | null;
};

type WorkingSessionFxResourceRecord = {
  fxResourceId: string;
  fileName: string;
  code: string;
};

type WorkingSessionRecord = {
  key: string;
  updatedAt: number;
  sessionRevision: string;
  sessionDocument: SessionDocument;
  sessionViewState?: SessionViewState | null;
  resources: WorkingSessionResourceRef[];
  retainedResources: WorkingSessionResourceRef[];
  fxResources?: WorkingSessionFxResourceRecord[];
  undoPast: SessionDocument[];
  undoFuture: SessionDocument[];
};

type WorkspaceResourceRecord = {
  resourceKey: string;
  updatedAt: number;
  fileBytes: Uint8Array;
};

export type SessionRenderTransfer = {
  token: string;
  createdAt: number;
  fileName: string;
  sourceSessionId: string;
  sourceSessionName: string;
  sourceSessionRevision: string;
  renderedAt: number;
  renderSampleRate: number;
  renderLengthSamples: number;
  channelCount: number;
  status: "pending" | "ready" | "error";
  wavBytes: Uint8Array | null;
  errorMessage: string | null;
};

type SessionRenderTransferRecord = SessionRenderTransfer;

export type WorkingSessionState = {
  archive: LoadedSessionArchive;
  sessionRevision: string;
  sessionViewState: SessionViewState | null;
  retainedResources: SessionArchiveResource[];
  undoPast: SessionDocument[];
  undoFuture: SessionDocument[];
};

const DB_NAME = "webdaw-workspace";
const ARCHIVE_STORE_NAME = "archives";
const SESSION_STORE_NAME = "sessions";
const RESOURCE_STORE_NAME = "resources";
const TRANSFER_STORE_NAME = "transfers";
const TRAJECTORY_STORE_NAME = "effectTrajectories";
const PRESET_STORE_NAME = "presetLibrary";
const DB_VERSION = 6;
export const DEFAULT_SESSION_NAME = "Untitled Session";
const SESSION_RENDER_TRANSFER_MAX_AGE_MS = 15 * 60 * 1000;
const SESSION_WRITER_LEASE_DURATION_MS = 8_000;
const SESSION_VIEW_LEASE_DURATION_MS = 15_000;

let openWorkspaceDatabasePromise: Promise<IDBDatabase | null> | null = null;

function getArchiveWorkspaceKey(sessionId: string): string {
  return `working:${sessionId}`;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed")));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed")));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")));
  });
}

export async function openWorkspaceDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return null;
  }
  if (openWorkspaceDatabasePromise) {
    return openWorkspaceDatabasePromise;
  }

  openWorkspaceDatabasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ARCHIVE_STORE_NAME)) {
        database.createObjectStore(ARCHIVE_STORE_NAME, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(SESSION_STORE_NAME)) {
        database.createObjectStore(SESSION_STORE_NAME, { keyPath: "sessionId" });
      }
      if (!database.objectStoreNames.contains(RESOURCE_STORE_NAME)) {
        database.createObjectStore(RESOURCE_STORE_NAME, { keyPath: "resourceKey" });
      }
      if (!database.objectStoreNames.contains(TRANSFER_STORE_NAME)) {
        database.createObjectStore(TRANSFER_STORE_NAME, { keyPath: "token" });
      }
      if (!database.objectStoreNames.contains(TRAJECTORY_STORE_NAME)) {
        database.createObjectStore(TRAJECTORY_STORE_NAME, {
          keyPath: ["sessionId", "effectInstanceId"],
        });
      }
      // Preset store key path changed from `[codeHash, configHash]` to
       // `[uiHash, configHash]` in v6 (preset identity is now derived from
       // the parameter signature, not the source code). The old store is
       // dropped : at this prototype stage, losing the existing presets is
       // acceptable. Future migrations should rebuild on top via a copy
       // step in this handler.
      if (database.objectStoreNames.contains(PRESET_STORE_NAME)) {
        database.deleteObjectStore(PRESET_STORE_NAME);
      }
      database.createObjectStore(PRESET_STORE_NAME, {
        keyPath: ["uiHash", "configHash"],
      });
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => {
        database.close();
        openWorkspaceDatabasePromise = null;
      });
      resolve(database);
    });
    request.addEventListener("error", () => {
      openWorkspaceDatabasePromise = null;
      reject(request.error ?? new Error("Unable to open IndexedDB"));
    });
  });

  return openWorkspaceDatabasePromise;
}

function normalizeSessionName(sessionName: string | null | undefined): string {
  const trimmed = sessionName?.trim();
  return trimmed ? trimmed : DEFAULT_SESSION_NAME;
}

function sanitizeWriterLease<T extends LocalSessionMetadata>(metadata: T, now = Date.now()): T {
  if (
    metadata.writerTabId
    && metadata.writerLeaseExpiresAt !== null
    && metadata.writerLeaseExpiresAt > now
  ) {
    return metadata;
  }
  if (metadata.writerTabId === null && metadata.writerLeaseExpiresAt === null) {
    return metadata;
  }
  return {
    ...metadata,
    writerTabId: null,
    writerLeaseExpiresAt: null,
  };
}

function sanitizeViewLeases(
  viewLeases: readonly { tabId: string; expiresAt: number }[] | null | undefined,
  now = Date.now(),
): { tabId: string; expiresAt: number }[] {
  const latestLeaseExpiryByTabId = new Map<string, number>();
  for (const lease of viewLeases ?? []) {
    if (
      !lease
      || typeof lease.tabId !== "string"
      || typeof lease.expiresAt !== "number"
      || lease.expiresAt <= now
    ) {
      continue;
    }
    const previousExpiry = latestLeaseExpiryByTabId.get(lease.tabId) ?? 0;
    if (lease.expiresAt > previousExpiry) {
      latestLeaseExpiryByTabId.set(lease.tabId, lease.expiresAt);
    }
  }
  return [...latestLeaseExpiryByTabId.entries()].map(([tabId, expiresAt]) => ({ tabId, expiresAt }));
}

function sanitizeSessionMetadata<T extends LocalSessionMetadata>(metadata: T, now = Date.now()): T {
  return sanitizeWriterLease({
    ...metadata,
    viewLeases: sanitizeViewLeases(metadata.viewLeases, now),
  }, now);
}

function isLegacyWorkingSessionRecord(record: unknown): record is LegacyWorkingSessionRecord {
  return typeof record === "object"
    && record !== null
    && typeof (record as { key?: unknown }).key === "string"
    && (record as { archiveBytes?: unknown }).archiveBytes instanceof Uint8Array;
}

function isWorkingSessionRecord(record: unknown): record is WorkingSessionRecord {
  return typeof record === "object"
    && record !== null
    && typeof (record as { key?: unknown }).key === "string"
    && typeof (record as { updatedAt?: unknown }).updatedAt === "number"
    && typeof (record as { sessionDocument?: unknown }).sessionDocument === "object"
    && record !== null
    && Array.isArray((record as { resources?: unknown }).resources)
    && Array.isArray((record as { retainedResources?: unknown }).retainedResources)
    && Array.isArray((record as { undoPast?: unknown }).undoPast)
    && Array.isArray((record as { undoFuture?: unknown }).undoFuture);
}

function collectReferencedResourceKeys(records: readonly WorkingSessionRecord[]): Set<string> {
  const referencedKeys = new Set<string>();
  for (const record of records) {
    for (const resource of record.resources) {
      referencedKeys.add(resource.resourceKey);
    }
    for (const resource of record.retainedResources) {
      referencedKeys.add(resource.resourceKey);
    }
  }
  return referencedKeys;
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function computeSha256ResourceKey(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${hexFromBytes(new Uint8Array(digest))}`;
}

async function garbageCollectWorkspaceResources(): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database || !database.objectStoreNames.contains(RESOURCE_STORE_NAME)) {
    return;
  }
  const transaction = database.transaction([ARCHIVE_STORE_NAME, RESOURCE_STORE_NAME], "readwrite");
  const archiveStore = transaction.objectStore(ARCHIVE_STORE_NAME);
  const resourceStore = transaction.objectStore(RESOURCE_STORE_NAME);
  const allArchiveRecords = await requestToPromise(archiveStore.getAll() as IDBRequest<unknown[]>);
  const referencedKeys = collectReferencedResourceKeys(allArchiveRecords.filter(isWorkingSessionRecord));
  const allResourceRecords = await requestToPromise(resourceStore.getAll() as IDBRequest<WorkspaceResourceRecord[]>);
  for (const resourceRecord of allResourceRecords) {
    if (!referencedKeys.has(resourceRecord.resourceKey)) {
      resourceStore.delete(resourceRecord.resourceKey);
    }
  }
  await transactionDone(transaction);
}

async function purgeExpiredSessionRenderTransfers(): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database || !database.objectStoreNames.contains(TRANSFER_STORE_NAME)) {
    return;
  }
  const transaction = database.transaction(TRANSFER_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRANSFER_STORE_NAME);
  const allTransfers = await requestToPromise(store.getAll() as IDBRequest<SessionRenderTransferRecord[]>);
  const minimumTimestamp = Date.now() - SESSION_RENDER_TRANSFER_MAX_AGE_MS;
  for (const transfer of allTransfers) {
    if (transfer.createdAt < minimumTimestamp) {
      store.delete(transfer.token);
    }
  }
  await transactionDone(transaction);
}

function canonicalizeSessionName(sessionName: string): string {
  return normalizeSessionName(sessionName).replace(/\s+/g, " ").toLocaleLowerCase();
}

function resolveUniqueSessionName(
  sessionName: string | null | undefined,
  existingSessions: LocalSessionMetadata[],
  excludedSessionId: string,
): string {
  const baseName = normalizeSessionName(sessionName);
  const existingNames = new Set(
    existingSessions
      .filter((session) => session.sessionId !== excludedSessionId)
      .map((session) => canonicalizeSessionName(session.sessionName)),
  );
  if (!existingNames.has(canonicalizeSessionName(baseName))) {
    return baseName;
  }
  let suffix = 2;
  while (existingNames.has(canonicalizeSessionName(`${baseName}-${suffix}`))) {
    suffix += 1;
  }
  return `${baseName}-${suffix}`;
}

export function createLocalSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getLocalSessionMetadata(sessionId: string): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readonly");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const record = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  await transactionDone(transaction);
  return record ? sanitizeSessionMetadata(record) : null;
}

export async function listLocalSessions(): Promise<LocalSessionMetadata[]> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return [];
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readonly");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const records = await requestToPromise(store.getAll() as IDBRequest<LocalSessionMetadata[]>);
  await transactionDone(transaction);
  return [...records]
    .map((record) => sanitizeSessionMetadata(record))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getMostRecentlyOpenedLocalSession(): Promise<LocalSessionMetadata | null> {
  const sessions = await listLocalSessions();
  if (sessions.length === 0) {
    return null;
  }
  return [...sessions].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)[0] ?? null;
}

export async function ensureLocalSessionMetadata(
  sessionId: string,
  sessionName?: string,
): Promise<LocalSessionMetadata> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    const now = Date.now();
    return {
      sessionId,
      sessionName: normalizeSessionName(sessionName),
      sessionRevision: null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      writerTabId: null,
      writerLeaseExpiresAt: null,
      viewLeases: [],
    };
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  const existingSessions = await requestToPromise(store.getAll() as IDBRequest<LocalSessionMetadata[]>);
  const now = Date.now();
  const resolvedSessionName = resolveUniqueSessionName(
    sessionName ?? existingRecord?.sessionName,
    existingSessions,
    sessionId,
  );
  const nextRecord: LocalSessionMetadata = existingRecord
    ? {
      ...existingRecord,
      sessionName: resolvedSessionName,
      sessionRevision: existingRecord.sessionRevision ?? null,
      updatedAt: now,
    }
    : {
      sessionId,
      sessionName: resolvedSessionName,
      sessionRevision: null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      writerTabId: null,
      writerLeaseExpiresAt: null,
      viewLeases: [],
    };
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord, now);
}

export async function touchLocalSessionOpened(sessionId: string): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const nextRecord: LocalSessionMetadata = {
    ...sanitizeSessionMetadata(existingRecord),
    lastOpenedAt: Date.now(),
  };
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord);
}

export async function claimLocalSessionWriter(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const now = Date.now();
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord, now);
  const nextRecord: LocalSessionMetadata =
    sanitizedRecord.writerTabId === null || sanitizedRecord.writerTabId === tabId
      ? {
        ...sanitizedRecord,
        writerTabId: tabId,
        writerLeaseExpiresAt: now + SESSION_WRITER_LEASE_DURATION_MS,
      }
      : sanitizedRecord;
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord, now);
}

export async function renewLocalSessionWriter(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const now = Date.now();
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord, now);
  const nextRecord: LocalSessionMetadata =
    sanitizedRecord.writerTabId === tabId
      ? {
        ...sanitizedRecord,
        writerLeaseExpiresAt: now + SESSION_WRITER_LEASE_DURATION_MS,
      }
      : sanitizedRecord;
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord, now);
}

export async function releaseLocalSessionWriter(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord);
  const nextRecord: LocalSessionMetadata =
    sanitizedRecord.writerTabId === tabId
      ? {
        ...sanitizedRecord,
        writerTabId: null,
        writerLeaseExpiresAt: null,
      }
      : sanitizedRecord;
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord);
}

export async function claimLocalSessionView(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const now = Date.now();
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord, now);
  const nextRecord: LocalSessionMetadata = {
    ...sanitizedRecord,
    viewLeases: [
      ...sanitizedRecord.viewLeases.filter((lease) => lease.tabId !== tabId),
      { tabId, expiresAt: now + SESSION_VIEW_LEASE_DURATION_MS },
    ],
  };
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord, now);
}

export async function renewLocalSessionView(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const now = Date.now();
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord, now);
  const hasLease = sanitizedRecord.viewLeases.some((lease) => lease.tabId === tabId);
  const nextRecord: LocalSessionMetadata = {
    ...sanitizedRecord,
    viewLeases: hasLease
      ? sanitizedRecord.viewLeases.map((lease) => (
        lease.tabId === tabId
          ? { tabId, expiresAt: now + SESSION_VIEW_LEASE_DURATION_MS }
          : lease
      ))
      : [...sanitizedRecord.viewLeases, { tabId, expiresAt: now + SESSION_VIEW_LEASE_DURATION_MS }],
  };
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord, now);
}

export async function releaseLocalSessionView(
  sessionId: string,
  tabId: string,
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
  const store = transaction.objectStore(SESSION_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return null;
  }
  const sanitizedRecord = sanitizeSessionMetadata(existingRecord);
  const nextRecord: LocalSessionMetadata = {
    ...sanitizedRecord,
    viewLeases: sanitizedRecord.viewLeases.filter((lease) => lease.tabId !== tabId),
  };
  store.put(nextRecord);
  await transactionDone(transaction);
  return sanitizeSessionMetadata(nextRecord);
}

export async function saveWorkingSessionArchive(
  sessionId: string,
  archiveBytes: Uint8Array,
  sessionName?: string,
  options?: {
    sessionRevision?: string;
    sessionViewState?: SessionViewState | null;
    retainedResources?: readonly SessionArchiveResource[];
    undoPast?: readonly SessionDocument[];
    undoFuture?: readonly SessionDocument[];
  },
): Promise<LocalSessionMetadata | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const archive = parseSessionArchive(archiveBytes);
  // Pre-compute all SHA-256 resource keys before opening the IDB transaction.
  // crypto.subtle.digest() yields to the browser event loop, which causes
  // Firefox to auto-commit the transaction if awaited inside it.
  const allResources = new Map<string, SessionArchiveResource>();
  for (const resource of archive.resources) {
    allResources.set(`${resource.resourceId}::current`, resource);
  }
  for (const resource of options?.retainedResources ?? []) {
    allResources.set(`${resource.resourceId}::retained`, resource);
  }
  const precomputedResourceKeys = new Map<string, string | null>();
  for (const [key, resource] of allResources) {
    precomputedResourceKeys.set(key, await computeSha256ResourceKey(resource.fileBytes));
  }
  const transaction = database.transaction([ARCHIVE_STORE_NAME, SESSION_STORE_NAME, RESOURCE_STORE_NAME], "readwrite");
  const archiveStore = transaction.objectStore(ARCHIVE_STORE_NAME);
  const sessionStore = transaction.objectStore(SESSION_STORE_NAME);
  const resourceStore = transaction.objectStore(RESOURCE_STORE_NAME);
  const existingSession = await requestToPromise(sessionStore.get(sessionId) as IDBRequest<LocalSessionMetadata | undefined>);
  const existingSessions = await requestToPromise(sessionStore.getAll() as IDBRequest<LocalSessionMetadata[]>);
  const now = Date.now();
  const sessionRevision = options?.sessionRevision ?? computeSessionDocumentRevision(archive.sessionDocument);
  const resourceRefs: WorkingSessionResourceRef[] = [];
  const retainedResourceRefs: WorkingSessionResourceRef[] = [];
  for (const [mapKey, resource] of allResources) {
    const resourceKey = precomputedResourceKeys.get(mapKey) ?? null;
    if (!resourceKey) {
      archiveStore.put({
        key: getArchiveWorkspaceKey(sessionId),
        updatedAt: now,
        archiveBytes,
        sessionViewState: options?.sessionViewState ?? null,
      } satisfies LegacyWorkingSessionRecord);
      const resolvedSessionName = resolveUniqueSessionName(
        sessionName ?? existingSession?.sessionName,
        existingSessions,
        sessionId,
      );
      const fallbackSession: LocalSessionMetadata = existingSession
        ? {
          ...sanitizeSessionMetadata(existingSession, now),
          sessionName: resolvedSessionName,
          sessionRevision,
          updatedAt: now,
        }
        : {
          sessionId,
          sessionName: resolvedSessionName,
          sessionRevision,
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
          writerTabId: null,
          writerLeaseExpiresAt: null,
          viewLeases: [],
        };
      sessionStore.put(fallbackSession);
      await transactionDone(transaction);
      return fallbackSession;
    }
    resourceStore.put({
      resourceKey,
      updatedAt: now,
      fileBytes: resource.fileBytes,
    } satisfies WorkspaceResourceRecord);
    const resourceRef = {
      resourceId: resource.resourceId,
      fileName: resource.fileName,
      mimeType: resource.mimeType,
      lastModified: resource.lastModified,
      resourceKey,
      sessionRender: resource.sessionRender ?? null,
    } satisfies WorkingSessionResourceRef;
    if (archive.resources.includes(resource)) {
      resourceRefs.push(resourceRef);
    }
    if ((options?.retainedResources ?? []).includes(resource)) {
      retainedResourceRefs.push(resourceRef);
    }
  }
  archiveStore.put({
    key: getArchiveWorkspaceKey(sessionId),
    updatedAt: now,
    sessionRevision,
    sessionDocument: archive.sessionDocument,
    sessionViewState: options?.sessionViewState ?? null,
    resources: resourceRefs,
    retainedResources: retainedResourceRefs,
    fxResources: archive.fxResources.map((fx) => ({
      fxResourceId: fx.fxResourceId,
      fileName: fx.fileName,
      code: fx.code,
    })),
    undoPast: [...(options?.undoPast ?? [])],
    undoFuture: [...(options?.undoFuture ?? [])],
  } satisfies WorkingSessionRecord);
  const resolvedSessionName = resolveUniqueSessionName(
    sessionName ?? existingSession?.sessionName,
    existingSessions,
    sessionId,
  );
  const nextSession: LocalSessionMetadata = existingSession
    ? {
      ...sanitizeSessionMetadata(existingSession, now),
      sessionName: resolvedSessionName,
      sessionRevision,
      updatedAt: now,
    }
    : {
      sessionId,
      sessionName: resolvedSessionName,
      sessionRevision,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      writerTabId: null,
      writerLeaseExpiresAt: null,
      viewLeases: [],
    };
  sessionStore.put(nextSession);
  await transactionDone(transaction);
  await garbageCollectWorkspaceResources();
  return sanitizeSessionMetadata(nextSession, now);
}

export async function saveWorkingSessionViewState(
  sessionId: string,
  sessionViewState: SessionViewState,
): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return;
  }
  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(ARCHIVE_STORE_NAME);
  const record = await requestToPromise(store.get(getArchiveWorkspaceKey(sessionId)) as IDBRequest<unknown>);
  if (!record) {
    await transactionDone(transaction);
    return;
  }
  if (isLegacyWorkingSessionRecord(record)) {
    if (areSessionViewStatesEqual(isSessionViewState(record.sessionViewState) ? record.sessionViewState : null, sessionViewState)) {
      await transactionDone(transaction);
      return;
    }
    store.put({
      ...record,
      sessionViewState,
    } satisfies LegacyWorkingSessionRecord);
    await transactionDone(transaction);
    return;
  }
  if (!isWorkingSessionRecord(record)) {
    await transactionDone(transaction);
    throw new Error("Invalid working session record");
  }
  if (areSessionViewStatesEqual(isSessionViewState(record.sessionViewState) ? record.sessionViewState : null, sessionViewState)) {
    await transactionDone(transaction);
    return;
  }
  store.put({
    ...record,
    sessionViewState,
  } satisfies WorkingSessionRecord);
  await transactionDone(transaction);
}

export async function loadWorkingSessionArchive(sessionId: string): Promise<WorkingSessionState | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readonly");
  const store = transaction.objectStore(ARCHIVE_STORE_NAME);
  const record = await requestToPromise(store.get(getArchiveWorkspaceKey(sessionId)) as IDBRequest<unknown>);
  await transactionDone(transaction);
  if (!record) {
    return null;
  }
  if (isLegacyWorkingSessionRecord(record)) {
    const archive = parseSessionArchive(record.archiveBytes);
    return {
      archive,
      sessionRevision: computeSessionDocumentRevision(archive.sessionDocument),
      sessionViewState: isSessionViewState(record.sessionViewState) ? record.sessionViewState : null,
      retainedResources: archive.resources,
      undoPast: [],
      undoFuture: [],
    };
  }
  if (!isWorkingSessionRecord(record)) {
    throw new Error("Invalid working session record");
  }
  if (!database.objectStoreNames.contains(RESOURCE_STORE_NAME)) {
    throw new Error("Missing workspace resources store");
  }
  const resourceTransaction = database.transaction(RESOURCE_STORE_NAME, "readonly");
  const resourceStore = resourceTransaction.objectStore(RESOURCE_STORE_NAME);
  const resources: SessionArchiveResource[] = [];
  for (const resourceRef of record.resources) {
    const resourceRecord = await requestToPromise(resourceStore.get(resourceRef.resourceKey) as IDBRequest<WorkspaceResourceRecord | undefined>);
    if (!resourceRecord) {
      throw new Error(`Missing workspace resource "${resourceRef.resourceKey}"`);
    }
    resources.push({
      resourceId: resourceRef.resourceId,
      fileName: resourceRef.fileName,
      mimeType: resourceRef.mimeType,
      lastModified: resourceRef.lastModified,
      fileBytes: resourceRecord.fileBytes,
      sessionRender: resourceRef.sessionRender ?? null,
    });
  }
  const retainedResources: SessionArchiveResource[] = [];
  for (const resourceRef of record.retainedResources) {
    const resourceRecord = await requestToPromise(resourceStore.get(resourceRef.resourceKey) as IDBRequest<WorkspaceResourceRecord | undefined>);
    if (!resourceRecord) {
      throw new Error(`Missing workspace resource "${resourceRef.resourceKey}"`);
    }
    retainedResources.push({
      resourceId: resourceRef.resourceId,
      fileName: resourceRef.fileName,
      mimeType: resourceRef.mimeType,
      lastModified: resourceRef.lastModified,
      fileBytes: resourceRecord.fileBytes,
      sessionRender: resourceRef.sessionRender ?? null,
    });
  }
  await transactionDone(resourceTransaction);
  return {
    archive: {
      sessionDocument: record.sessionDocument,
      resources,
      fxResources: (record.fxResources ?? []).map((fx) => ({
        fxResourceId: fx.fxResourceId,
        fileName: fx.fileName,
        code: fx.code,
      })),
    },
    sessionRevision: record.sessionRevision ?? computeSessionDocumentRevision(record.sessionDocument),
    sessionViewState: isSessionViewState(record.sessionViewState) ? record.sessionViewState : null,
    retainedResources,
    undoPast: [...record.undoPast],
    undoFuture: [...record.undoFuture],
  };
}

export async function clearWorkingSessionArchive(sessionId: string): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return;
  }
  const transaction = database.transaction(ARCHIVE_STORE_NAME, "readwrite");
  const store = transaction.objectStore(ARCHIVE_STORE_NAME);
  store.delete(getArchiveWorkspaceKey(sessionId));
  await transactionDone(transaction);
}

export async function deleteLocalSession(sessionId: string): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return;
  }
  const transaction = database.transaction([ARCHIVE_STORE_NAME, SESSION_STORE_NAME], "readwrite");
  transaction.objectStore(ARCHIVE_STORE_NAME).delete(getArchiveWorkspaceKey(sessionId));
  transaction.objectStore(SESSION_STORE_NAME).delete(sessionId);
  await transactionDone(transaction);
  await garbageCollectWorkspaceResources();
}

export async function createSessionRenderTransfer(
  metadata: Omit<SessionRenderTransfer, "status" | "wavBytes" | "errorMessage">,
): Promise<SessionRenderTransfer> {
  const database = await openWorkspaceDatabase();
  const transfer: SessionRenderTransfer = {
    ...metadata,
    status: "pending",
    wavBytes: null,
    errorMessage: null,
  };
  if (!database) {
    return transfer;
  }
  await purgeExpiredSessionRenderTransfers();
  const transaction = database.transaction(TRANSFER_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRANSFER_STORE_NAME);
  store.put(transfer satisfies SessionRenderTransferRecord);
  await transactionDone(transaction);
  return transfer;
}

export async function getSessionRenderTransfer(token: string): Promise<SessionRenderTransfer | null> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return null;
  }
  const transaction = database.transaction(TRANSFER_STORE_NAME, "readonly");
  const store = transaction.objectStore(TRANSFER_STORE_NAME);
  const transfer = await requestToPromise(store.get(token) as IDBRequest<SessionRenderTransferRecord | undefined>);
  await transactionDone(transaction);
  return transfer ?? null;
}

export async function resolveSessionRenderTransfer(
  token: string,
  wavBytes: Uint8Array,
): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return;
  }
  const transaction = database.transaction(TRANSFER_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRANSFER_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(token) as IDBRequest<SessionRenderTransferRecord | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return;
  }
  store.put({
    ...existingRecord,
    status: "ready",
    wavBytes,
    errorMessage: null,
  } satisfies SessionRenderTransferRecord);
  await transactionDone(transaction);
}

export async function rejectSessionRenderTransfer(
  token: string,
  errorMessage: string,
): Promise<void> {
  const database = await openWorkspaceDatabase();
  if (!database) {
    return;
  }
  const transaction = database.transaction(TRANSFER_STORE_NAME, "readwrite");
  const store = transaction.objectStore(TRANSFER_STORE_NAME);
  const existingRecord = await requestToPromise(store.get(token) as IDBRequest<SessionRenderTransferRecord | undefined>);
  if (!existingRecord) {
    await transactionDone(transaction);
    return;
  }
  store.put({
    ...existingRecord,
    status: "error",
    wavBytes: null,
    errorMessage,
  } satisfies SessionRenderTransferRecord);
  await transactionDone(transaction);
}
