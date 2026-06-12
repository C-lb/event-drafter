import { describe, it, expect } from 'vitest';
import { extractEdmSummary, normalizeEdmBody } from '../src/edm-extract.js';

// Mirrors the actual SPARK Leighton invite stored in event id=1.
// Includes the Markdown-emphasis Gmail rendering, label-on-its-own-line
// layout, urldefense safelink wrapper, and FEATURED SPEAKER block.
const REAL_BODY = `I hope this email finds you well.

As part of the *SPARK Distinguished Leader Series, *we are pleased to
invite you to an exclusive dinner on *3 June 2026, Wednesday, 12:00PM to
2:00PM at Garibaldi Italian Restaurant & Bar. *

This session features *Dr. Tom Leighton, CEO and Co-Founder of Akamai, *widely
recognised as one of the pioneers behind modern internet infrastructure.

For more information, please refer to the details included in the eDM below.

Cheers!

David Chin
Chief Executive | SPARK

*SPARK LEADERS' LUNCH CIRCLE*
*Date:*
*3 June 2026, Wednesday*   *Time:*
*12:00PM – 2:00PM*

*Venue:*
*Garibaldi Italian Restaurant & Bar*

*REGISTER*
<https://urldefense.com/v3/__https:/forms.gle/tusiJXRzm8UtzVuE9__;!!LSAcJDlP!yo$>

*FEATURED SPEAKER*

*DR. TOM LEIGHTON*

CEO & Co-Founder,
Akamai
`;

describe('normalizeEdmBody', () => {
  it('strips Markdown-style asterisks', () => {
    const out = normalizeEdmBody('*Venue:* *Garibaldi*');
    expect(out).toContain('Venue:');
    expect(out).not.toContain('*');
  });

  it('collapses "Label:\\nValue" into one line', () => {
    const out = normalizeEdmBody('Venue:\nGaribaldi Italian Restaurant');
    expect(out).toContain('Venue: Garibaldi Italian Restaurant');
  });

  it('inserts a break before a same-physical-line Time label', () => {
    const out = normalizeEdmBody('Date: 3 June 2026, Wednesday   Time:\n12:00PM – 2:00PM');
    expect(out).toMatch(/Date: 3 June 2026, Wednesday\nTime: 12:00PM – 2:00PM/);
  });
});

describe('extractEdmSummary on the real SPARK body', () => {
  const s = extractEdmSummary(REAL_BODY, 'Invitation to SPARK Private Lunch w. Dr Tom Leighton', 2026);

  it('extracts the date', () => {
    expect(s.date_long).toMatch(/3 June 2026/);
    expect(s.date_local).toMatch(/^2026-06-03T/);
  });

  it('extracts the time range', () => {
    expect(s.time_str).toMatch(/12:00PM.*2:00PM/i);
  });

  it('extracts the venue', () => {
    expect(s.venue).toBe('Garibaldi Italian Restaurant & Bar');
  });

  it('extracts the featured speaker via the FEATURED SPEAKER block', () => {
    expect(s.speakers).toEqual(['Dr. Tom Leighton']);
  });

  it('prefers forms.gle over urldefense for the registration link', () => {
    expect(s.registration).toContain('forms.gle/tusiJXRzm8UtzVuE9');
    expect(s.registration).not.toContain('urldefense');
  });
});
