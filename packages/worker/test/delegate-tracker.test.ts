import { describe, it, expect } from 'vitest';
import { planDelegateReorder, phoneKey } from '../src/google/sheets.js';

// Real tracker layout: No, Company Name, Salutation, First Name, Last Name,
// Title, Email, Mobile No., Duplicates
const HEADER = ['No', 'Company Name', 'Salutation', 'First Name', 'Last Name', 'Title', 'Email', 'Mobile No.', 'Duplicates'];
function row(no: string, first: string, mobile: string): string[] {
  return [no, 'Acme', 'Mr', first, 'Tan', 'Mgr', `${first}@x.co`, mobile, ''];
}

describe('phoneKey', () => {
  it('normalizes to the last 8 digits', () => {
    expect(phoneKey('+65 9123 4567')).toBe('91234567');
    expect(phoneKey('+6591234567')).toBe('91234567');
    expect(phoneKey('9123 4567')).toBe('91234567');
    expect(phoneKey(null)).toBe('');
  });
});

describe('planDelegateReorder', () => {
  it('shifts confirmed rows to the top and renumbers No', () => {
    const values = [
      HEADER,
      row('1', 'Alice', '+65 9111 1111'),
      row('2', 'Bob', '+65 9222 2222'),
      row('3', 'Cara', '+65 9333 3333'),
    ];
    // Bob confirmed (stored in +65 e.164 form — must still match the sheet).
    const plan = planDelegateReorder(values, new Set([phoneKey('+6592222222')]));

    expect(plan.changed).toBe(true);
    expect(plan.confirmed).toBe(1);
    // Bob first, then pending in original order.
    expect(plan.values[1]![3]).toBe('Bob');
    expect(plan.values[2]![3]).toBe('Alice');
    expect(plan.values[3]![3]).toBe('Cara');
    // No column renumbered 1..N.
    expect(plan.values.slice(1).map((r) => r[0])).toEqual(['1', '2', '3']);
    // Header untouched.
    expect(plan.values[0]).toEqual(HEADER);
  });

  it('preserves stable order within the confirmed and pending groups', () => {
    const values = [
      HEADER,
      row('1', 'Alice', '+65 9111 1111'),
      row('2', 'Bob', '+65 9222 2222'),
      row('3', 'Cara', '+65 9333 3333'),
    ];
    const plan = planDelegateReorder(values, new Set([phoneKey('9111 1111'), phoneKey('9333 3333')]));
    expect(plan.values.slice(1).map((r) => r[3])).toEqual(['Alice', 'Cara', 'Bob']);
  });

  it('is idempotent — already-ordered input reports no change', () => {
    const values = [
      HEADER,
      row('1', 'Bob', '+65 9222 2222'),
      row('2', 'Alice', '+65 9111 1111'),
    ];
    const plan = planDelegateReorder(values, new Set([phoneKey('9222 2222')]));
    expect(plan.changed).toBe(false);
  });

  it('does nothing when there is no Mobile column', () => {
    const values = [
      ['No', 'First Name', 'Email'],
      ['1', 'Alice', 'a@x.co'],
    ];
    const plan = planDelegateReorder(values, new Set(['91111111']));
    expect(plan.changed).toBe(false);
  });
});
