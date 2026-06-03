/******************************* error-message.ts *****************************
 *
 * Purpose: Convert an unknown thrown value (the shape TypeScript catch clauses
 *          hand us) into a user-facing string for log entries and footer
 *          statuses. A tiny shared helper; every subsystem needs it.
 *
 ******************************************************************************/

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
