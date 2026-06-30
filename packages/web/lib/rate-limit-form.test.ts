import { describe, it, expect } from 'vitest';
import { toMs, fromMs, warnings, FORM_DEFAULTS } from './rate-limit-form';

describe('rate-limit-form — round-trip', () => {
  it('toMs(fromMs(x)) === x for the defaults', () => {
    const ms = toMs(FORM_DEFAULTS);
    const back = fromMs(ms);
    expect(back).toEqual(FORM_DEFAULTS);
  });

  it('arbitrary round-trip', () => {
    const f = { minGapSec: 5, maxGapSec: 20, batchLimit: 4, cooldownMinMin: 10, cooldownMaxMin: 25, maxSendsPerHour: 12 };
    expect(fromMs(toMs(f))).toEqual(f);
  });
});

describe('rate-limit-form — warnings', () => {
  it('is empty for the defaults', () => {
    expect(Object.keys(warnings(FORM_DEFAULTS))).toHaveLength(0);
  });

  it('flags minGapSec < 10', () => {
    const w = warnings({ ...FORM_DEFAULTS, minGapSec: 5 });
    expect(w.minGapSec).toMatch(/ban risk/);
  });

  it('flags maxSendsPerHour > 18', () => {
    const w = warnings({ ...FORM_DEFAULTS, maxSendsPerHour: 40 });
    expect(w.maxSendsPerHour).toMatch(/ban risk/);
  });

  it('flags both when both are aggressive', () => {
    const w = warnings({ ...FORM_DEFAULTS, minGapSec: 5, maxSendsPerHour: 40 });
    expect(w.minGapSec).toBeTruthy();
    expect(w.maxSendsPerHour).toBeTruthy();
  });

  it('flags cooldownMinMin < 15', () => {
    const w = warnings({ ...FORM_DEFAULTS, cooldownMinMin: 10 });
    expect(w.cooldownMinMin).toMatch(/ban risk/);
  });

  it('flags batchLimit > 8', () => {
    const w = warnings({ ...FORM_DEFAULTS, batchLimit: 10 });
    expect(w.batchLimit).toMatch(/ban risk/);
  });

  it('does not warn on exact boundary values', () => {
    const w = warnings({ minGapSec: 10, maxSendsPerHour: 18, cooldownMinMin: 15, batchLimit: 8, maxGapSec: 15, cooldownMaxMin: 30 });
    expect(Object.keys(w)).toHaveLength(0);
  });
});
