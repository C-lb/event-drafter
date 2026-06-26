import { describe, it, expect } from 'vitest';
import { parseSheetUrl, rangeStartRow } from '../src/google/sheets.js';

describe('parseSheetUrl', () => {
  it('extracts ID from full edit URL', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbC_dEFghIJKlMnOPqr-stUVwxYZ1234567890ABCDE/edit#gid=0';
    expect(parseSheetUrl(url)).toEqual({ spreadsheet_id: '1AbC_dEFghIJKlMnOPqr-stUVwxYZ1234567890ABCDE' });
  });

  it('accepts bare ID', () => {
    expect(parseSheetUrl('1AbC_dEFghIJKlMnOPqr-stUVwxYZ1234567890ABCDE')).toEqual({
      spreadsheet_id: '1AbC_dEFghIJKlMnOPqr-stUVwxYZ1234567890ABCDE',
    });
  });

  it('throws on garbage', () => {
    expect(() => parseSheetUrl('not a sheet')).toThrow();
  });
});

describe('rangeStartRow', () => {
  it('defaults to 1 for top-anchored ranges', () => {
    expect(rangeStartRow('A1:Z')).toBe(1);
    expect(rangeStartRow('A1:Z1000')).toBe(1);
  });

  it('reads the start row from an offset range', () => {
    expect(rangeStartRow('A5:G')).toBe(5);
    expect(rangeStartRow('B12:D40')).toBe(12);
  });

  it('strips a sheet-name prefix before parsing', () => {
    expect(rangeStartRow('Sheet1!A2:G')).toBe(2);
    expect(rangeStartRow("'My Sheet'!C7:Z")).toBe(7);
  });

  it('falls back to 1 when no row is given', () => {
    expect(rangeStartRow('A:Z')).toBe(1);
  });
});
