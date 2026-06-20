/**
 * Pure highlight navigation for the reply triage queue. No React, no DOM —
 * unit-tested in queue-nav.test.ts.
 *
 * "Terminal" cards are ones the operator has already actioned (sending/sent/
 * skipped/resolved) and collapsed; the highlight skips over them.
 */

/** j/k navigation: step one card in `dir`, skipping terminal cards. Stays on
 *  `current` at the boundary. Returns null only for an empty list. */
export function stepHighlight(
  orderedIds: number[],
  current: number | null,
  isTerminal: (id: number) => boolean,
  dir: 1 | -1,
): number | null {
  if (orderedIds.length === 0) return null;
  const start = current === null ? (dir === 1 ? -1 : orderedIds.length) : orderedIds.indexOf(current);
  for (let i = start + dir; i >= 0 && i < orderedIds.length; i += dir) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  return current;
}

/** Post-action auto-advance: first non-terminal after `current`; else the
 *  nearest non-terminal before it; else null (queue cleared). */
export function advanceHighlight(
  orderedIds: number[],
  current: number | null,
  isTerminal: (id: number) => boolean,
): number | null {
  const start = current === null ? -1 : orderedIds.indexOf(current);
  for (let i = start + 1; i < orderedIds.length; i++) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  for (let i = start - 1; i >= 0; i--) {
    if (!isTerminal(orderedIds[i])) return orderedIds[i];
  }
  return null;
}
