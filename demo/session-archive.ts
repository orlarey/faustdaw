import type { SessionDocument } from "./session-document.js";

type ZipEntry = {
  path: string;
  bytes: Uint8Array;
};

export type SessionArchiveResource = {
  resourceId: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  fileBytes: Uint8Array;
  sessionRender: SessionRenderResourceLink | null;
};

export type SessionArchiveFxResource = {
  fxResourceId: string;
  fileName: string;
  code: string;
};

export type LoadedSessionArchive = {
  sessionDocument: SessionDocument;
  resources: SessionArchiveResource[];
  fxResources: SessionArchiveFxResource[];
};

export type SessionRenderResourceLink = {
  sourceSessionId: string;
  sourceSessionName: string;
  sourceSessionRevision: string;
  renderedAt: number;
  renderSampleRate: number;
  renderLengthSamples: number;
  channelCount: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_STORED_COMPRESSION_METHOD = 0;
const ZIP_VERSION = 20;
const RIFF_HEADER_SIZE_BYTES = 44;
const RESOURCE_METADATA_PATH = "resources.json";
const FX_RESOURCE_METADATA_PATH = "fx-resources.json";
const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc = crc32Table[(crc ^ value) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

function buildStoredZip(entries: readonly ZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const pathBytes = textEncoder.encode(entry.path);
    const crc32 = computeCrc32(entry.bytes);
    const localHeader = new Uint8Array(30 + pathBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
    localView.setUint16(4, ZIP_VERSION, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, ZIP_STORED_COMPRESSION_METHOD, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc32, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, pathBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(pathBytes, 30);
    localChunks.push(localHeader, entry.bytes);

    const centralHeader = new Uint8Array(46 + pathBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
    centralView.setUint16(4, ZIP_VERSION, true);
    centralView.setUint16(6, ZIP_VERSION, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, ZIP_STORED_COMPRESSION_METHOD, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc32, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, pathBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(pathBytes, 46);
    centralChunks.push(centralHeader);

    localOffset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concatUint8Arrays(centralChunks);
  const endOfCentralDirectory = new Uint8Array(22);
  const endView = new DataView(endOfCentralDirectory.buffer);
  endView.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return concatUint8Arrays([...localChunks, centralDirectory, endOfCentralDirectory]);
}

function findEndOfCentralDirectoryOffset(bytes: Uint8Array): number {
  const minimumOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50
      && bytes[offset + 1] === 0x4b
      && bytes[offset + 2] === 0x05
      && bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("Invalid session archive: end of central directory not found");
}

function parseStoredZip(bytes: Uint8Array): ZipEntry[] {
  const endOffset = findEndOfCentralDirectoryOffset(bytes);
  const endView = new DataView(bytes.buffer, bytes.byteOffset + endOffset, 22);
  const entryCount = endView.getUint16(10, true);
  const centralDirectoryOffset = endView.getUint32(16, true);
  const entries: ZipEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const centralView = new DataView(bytes.buffer, bytes.byteOffset + cursor);
    if (centralView.getUint32(0, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid session archive: central directory entry signature mismatch");
    }
    const compressionMethod = centralView.getUint16(10, true);
    if (compressionMethod !== ZIP_STORED_COMPRESSION_METHOD) {
      throw new Error("Unsupported session archive compression method");
    }
    const compressedSize = centralView.getUint32(20, true);
    const fileNameLength = centralView.getUint16(28, true);
    const extraFieldLength = centralView.getUint16(30, true);
    const fileCommentLength = centralView.getUint16(32, true);
    const localHeaderOffset = centralView.getUint32(42, true);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const path = textDecoder.decode(bytes.subarray(fileNameStart, fileNameEnd));

    const localView = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset);
    if (localView.getUint32(0, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error("Invalid session archive: local header signature mismatch");
    }
    const localFileNameLength = localView.getUint16(26, true);
    const localExtraFieldLength = localView.getUint16(28, true);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    const dataEnd = dataStart + compressedSize;
    entries.push({
      path,
      bytes: bytes.slice(dataStart, dataEnd),
    });

    cursor = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return entries;
}

type SessionArchiveResourceMetadata = {
  resourceId: string;
  fileName: string;
  mimeType: string;
  lastModified: number;
  path: string;
  sessionRender: SessionRenderResourceLink | null;
};

type SessionArchiveFxResourceMetadata = {
  fxResourceId: string;
  fileName: string;
  path: string;
};

function getResourceArchivePath(resourceId: string, fileName: string): string {
  return `resources/${buildArchiveResourceDirectoryName(resourceId)}/${buildArchiveResourceFileName(fileName)}`;
}

function getResourceIdFromArchivePath(path: string): string | null {
  if (!path.startsWith("resources/")) {
    return null;
  }
  const segments = path.split("/");
  if (segments.length < 3) {
    return null;
  }
  const encodedId = segments[1];
  if (!encodedId) {
    return null;
  }
  try {
    return decodeURIComponent(encodedId);
  } catch {
    throw new Error(`Invalid session archive resource path "${path}"`);
  }
}

function getFileNameFromArchivePath(path: string): string | null {
  if (!path.startsWith("resources/")) {
    return null;
  }
  const segments = path.split("/");
  const encodedFileName = segments.at(-1);
  if (!encodedFileName) {
    return null;
  }
  try {
    return decodeURIComponent(encodedFileName);
  } catch {
    throw new Error(`Invalid session archive resource path "${path}"`);
  }
}

function getFxResourceArchivePath(fileName: string): string {
  return `fx/${buildArchiveResourceFileName(fileName)}`;
}

function encodeSessionDocument(sessionDocument: SessionDocument): Uint8Array {
  return textEncoder.encode(JSON.stringify(sessionDocument, null, 2));
}

function encodeResourceMetadata(metadata: readonly SessionArchiveResourceMetadata[]): Uint8Array {
  return textEncoder.encode(JSON.stringify(metadata, null, 2));
}

function encodeFxResourceMetadata(metadata: readonly SessionArchiveFxResourceMetadata[]): Uint8Array {
  return textEncoder.encode(JSON.stringify(metadata, null, 2));
}

function decodeFxResourceMetadata(bytes: Uint8Array): SessionArchiveFxResourceMetadata[] {
  const parsed = JSON.parse(textDecoder.decode(bytes)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid fx-resources.json document");
  }
  return parsed.map((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || typeof entry.fxResourceId !== "string"
      || typeof entry.fileName !== "string"
      || typeof entry.path !== "string"
    ) {
      throw new Error("Invalid fx-resources.json document");
    }
    return entry as SessionArchiveFxResourceMetadata;
  });
}

function slugifyArchivePathPart(value: string, fallback: string): string {
  const withoutDiacritics = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const slug = withoutDiacritics
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || fallback;
}

function getArchivePathHash(value: string): string {
  return computeCrc32(textEncoder.encode(value)).toString(16).padStart(8, "0");
}

function buildArchiveResourceDirectoryName(resourceId: string): string {
  return `${slugifyArchivePathPart(resourceId, "resource")}--${getArchivePathHash(resourceId)}`;
}

function buildArchiveResourceFileName(fileName: string): string {
  const extensionMatch = /\.([^.]+)$/.exec(fileName.trim());
  const extension = extensionMatch?.[1]?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
  const baseName = extensionMatch ? fileName.slice(0, -extensionMatch[0].length) : fileName;
  const slugBaseName = slugifyArchivePathPart(baseName, "file");
  return extension
    ? `${slugBaseName}--${getArchivePathHash(fileName)}.${extension}`
    : `${slugBaseName}--${getArchivePathHash(fileName)}`;
}

function decodeSessionDocument(bytes: Uint8Array): SessionDocument {
  const parsed = JSON.parse(textDecoder.decode(bytes)) as Partial<SessionDocument>;
  if (parsed.version !== 1 || !Number.isInteger(parsed.sampleRate) || !Array.isArray(parsed.tracks)) {
    throw new Error("Invalid session.json document");
  }
  return parsed as SessionDocument;
}

function decodeResourceMetadata(bytes: Uint8Array): SessionArchiveResourceMetadata[] {
  const parsed = JSON.parse(textDecoder.decode(bytes)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid resources.json document");
  }
  return parsed.map((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || typeof entry.resourceId !== "string"
      || typeof entry.fileName !== "string"
      || typeof entry.mimeType !== "string"
      || !Number.isInteger(entry.lastModified)
      || typeof entry.path !== "string"
      || !(
        entry.sessionRender === null
        || entry.sessionRender === undefined
        || (
          typeof entry.sessionRender === "object"
          && entry.sessionRender !== null
          && typeof entry.sessionRender.sourceSessionId === "string"
          && typeof entry.sessionRender.sourceSessionName === "string"
          && typeof entry.sessionRender.sourceSessionRevision === "string"
          && Number.isInteger(entry.sessionRender.renderedAt)
          && Number.isInteger(entry.sessionRender.renderSampleRate)
          && Number.isInteger(entry.sessionRender.renderLengthSamples)
          && Number.isInteger(entry.sessionRender.channelCount)
        )
      )
    ) {
      throw new Error("Invalid resources.json document");
    }
    return {
      ...entry,
      sessionRender: entry.sessionRender ?? null,
    } as SessionArchiveResourceMetadata;
  });
}

export function audioBufferToWavBytes(buffer: AudioBuffer): Uint8Array {
  const channelCount = buffer.numberOfChannels;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = buffer.sampleRate * blockAlign;
  const dataByteLength = frameCount * blockAlign;
  const wavBytes = new Uint8Array(RIFF_HEADER_SIZE_BYTES + dataByteLength);
  const view = new DataView(wavBytes.buffer);
  const channelData = Array.from({ length: channelCount }, (_, channelIndex) => buffer.getChannelData(channelIndex));
  let offset = 0;

  const writeAscii = (value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset++, value.charCodeAt(index));
    }
  };

  writeAscii("RIFF");
  view.setUint32(offset, 36 + dataByteLength, true);
  offset += 4;
  writeAscii("WAVE");
  writeAscii("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, channelCount, true);
  offset += 2;
  view.setUint32(offset, buffer.sampleRate, true);
  offset += 4;
  view.setUint32(offset, byteRate, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeAscii("data");
  view.setUint32(offset, dataByteLength, true);
  offset += 4;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const clampedSample = Math.max(-1, Math.min(1, channelData[channelIndex]![frameIndex]!));
      const pcmSample = clampedSample < 0
        ? Math.round(clampedSample * 0x8000)
        : Math.round(clampedSample * 0x7fff);
      view.setInt16(offset, pcmSample, true);
      offset += bytesPerSample;
    }
  }

  return wavBytes;
}

export function buildSessionArchiveBytes(
  sessionDocument: SessionDocument,
  resources: readonly {
    resourceId: string;
    fileName: string;
    mimeType: string;
    lastModified: number;
    fileBytes: Uint8Array;
    sessionRender?: SessionRenderResourceLink | null;
  }[],
  fxResources: readonly SessionArchiveFxResource[] = [],
): Uint8Array {
  const resourceMetadata: SessionArchiveResourceMetadata[] = resources.map((resource) => ({
    resourceId: resource.resourceId,
    fileName: resource.fileName,
    mimeType: resource.mimeType,
    lastModified: resource.lastModified,
    path: getResourceArchivePath(resource.resourceId, resource.fileName),
    sessionRender: resource.sessionRender ?? null,
  }));

  const fxResourceMetadata: SessionArchiveFxResourceMetadata[] = fxResources.map((fx) => ({
    fxResourceId: fx.fxResourceId,
    fileName: fx.fileName,
    path: getFxResourceArchivePath(fx.fileName),
  }));

  return buildStoredZip([
    {
      path: "session.json",
      bytes: encodeSessionDocument(sessionDocument),
    },
    {
      path: RESOURCE_METADATA_PATH,
      bytes: encodeResourceMetadata(resourceMetadata),
    },
    ...resources.map((resource) => ({
      path: getResourceArchivePath(resource.resourceId, resource.fileName),
      bytes: resource.fileBytes,
    })),
    ...(fxResources.length > 0 ? [
      {
        path: FX_RESOURCE_METADATA_PATH,
        bytes: encodeFxResourceMetadata(fxResourceMetadata),
      },
      ...fxResources.map((fx) => ({
        path: getFxResourceArchivePath(fx.fileName),
        bytes: textEncoder.encode(fx.code),
      })),
    ] : []),
  ]);
}

export function parseSessionArchive(bytes: Uint8Array): LoadedSessionArchive {
  const entries = parseStoredZip(bytes);
  const sessionEntry = entries.find((entry) => entry.path === "session.json");
  if (!sessionEntry) {
    throw new Error("Invalid session archive: missing session.json");
  }
  const resourceMetadataEntry = entries.find((entry) => entry.path === RESOURCE_METADATA_PATH);
  const fxResourceMetadataEntry = entries.find((entry) => entry.path === FX_RESOURCE_METADATA_PATH);
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const resourceMetadata = resourceMetadataEntry ? decodeResourceMetadata(resourceMetadataEntry.bytes) : null;

  // Parse FX resources from fx/ folder
  const fxResources: SessionArchiveFxResource[] = [];
  if (fxResourceMetadataEntry) {
    const fxMetadata = decodeFxResourceMetadata(fxResourceMetadataEntry.bytes);
    for (const metadata of fxMetadata) {
      const fxEntry = entryByPath.get(metadata.path);
      if (!fxEntry) {
        throw new Error(`Invalid session archive: missing FX resource "${metadata.path}"`);
      }
      fxResources.push({
        fxResourceId: metadata.fxResourceId,
        fileName: metadata.fileName,
        code: textDecoder.decode(fxEntry.bytes),
      });
    }
  }

  if (resourceMetadata) {
    return {
      sessionDocument: decodeSessionDocument(sessionEntry.bytes),
      resources: resourceMetadata.map((metadata) => {
        const resourceEntry = entryByPath.get(metadata.path);
        if (!resourceEntry) {
          throw new Error(`Invalid session archive: missing resource payload "${metadata.path}"`);
        }
        return {
          resourceId: metadata.resourceId,
          fileName: metadata.fileName,
          mimeType: metadata.mimeType,
          lastModified: metadata.lastModified,
          fileBytes: resourceEntry.bytes,
          sessionRender: metadata.sessionRender ?? null,
        };
      }),
      fxResources,
    };
  }

  return {
    sessionDocument: decodeSessionDocument(sessionEntry.bytes),
    resources: entries.flatMap((entry) => {
      const resourceId = getResourceIdFromArchivePath(entry.path);
      const fileName = getFileNameFromArchivePath(entry.path);
      return resourceId && fileName ? [{
        resourceId,
        fileName,
        mimeType: fileName.endsWith(".wav") ? "audio/wav" : "application/octet-stream",
        lastModified: 0,
        fileBytes: entry.bytes,
        sessionRender: null,
      }] : [];
    }),
    fxResources,
  };
}
