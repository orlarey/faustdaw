/****************************** drag-predicates.ts ****************************
 *
 * Purpose: Shared DataTransfer inspection helpers used by drop zones. Safari
 *          omits MIME details during `dragover`, so we check types, item
 *          kinds, and files.length across a couple of paths to decide
 *          whether a drag payload contains one or more local files.
 *
 ******************************************************************************/

/**
 * Purpose: Decide whether a drag payload contains one or more local files,
 *          even when Safari omits MIME details during dragover.
 * How: Inspect DataTransfer.types first, then fall back to file-kind items
 *      or the Files payload length.
 */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (Array.from(dataTransfer.types).includes("Files")) {
    return true;
  }

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === "file") {
      return true;
    }
  }

  return dataTransfer.files.length > 0;
}
