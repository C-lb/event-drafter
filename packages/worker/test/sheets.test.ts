import { describe, it, expect } from 'vitest';
import { parseSheetUrl } from '../src/google/sheets.js';

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
