import { describe, it, expect } from 'vitest';
import {
  extractDate,
  extractTime,
  extractVenue,
  extractAddress,
  extractDressCode,
  extractHighlights,
  extractSpeakers,
  extractRegistrationLink,
  extractEdmSummary,
  renderEdmSummary,
  summarizeEdm,
} from '../src/edm-extract.js';

// Canonical SPARK flagship body — modelled on templates/draft-messages.md.
const SPARK_BODY = `Good afternoon,

We would be delighted to have you join us at our SPARK Lunch on Thursday, 27 February 2025, from 12:00 PM to 2:00 PM, at Garibaldi.

Date: Thursday, 27 February 2025
Time: 12:00 PM to 2:00 PM (Registration & networking opens at 11:30 AM)
Venue: Garibaldi
Address: 36 Purvis Street, Singapore 188613
Dress Code: Business

Join our esteemed panel of speakers from leading organisations, such as Jane Doe, John Smith and Mei Lin and others as they share their insights.

Key Program Highlights:

• Future of finance
• AI policy and regulation
• Cross-border ventures
• Q&A with the panel

The registration link: bit.ly/spark-feb-25
`;

describe('extractDate', () => {
  it('parses "Thursday, 27 February 2025"', () => {
    const got = extractDate(SPARK_BODY, 2025);
    expect(got?.value).toEqual({ year: 2025, month: 1, day: 27 });
  });

  it('parses "February 27, 2025"', () => {
    expect(extractDate('on February 27, 2025 at 3pm', 2025)?.value).toEqual({ year: 2025, month: 1, day: 27 });
  });

  it('falls back to year when only day+month given', () => {
    expect(extractDate('on 5 June at 9am', 2026)?.value).toEqual({ year: 2026, month: 5, day: 5 });
  });

  it('parses ISO yyyy-mm-dd', () => {
    expect(extractDate('event 2025-02-27', 2024)?.value).toEqual({ year: 2025, month: 1, day: 27 });
  });
});

describe('extractTime', () => {
  it('parses a "12:00 PM to 2:00 PM" range', () => {
    expect(extractTime(SPARK_BODY)?.value).toEqual({ hour: 12, minute: 0 });
  });

  it('parses an en-dash range', () => {
    expect(extractTime('Time: 7.00PM – 9.00PM')?.value).toEqual({ hour: 19, minute: 0 });
  });

  it('parses a single time', () => {
    expect(extractTime('Time: 6:30 PM')?.value).toEqual({ hour: 18, minute: 30 });
  });

  it('does not match a bare year', () => {
    expect(extractTime('held in 2025 only')).toBeNull();
  });
});

describe('extractVenue / address / dress', () => {
  it('extracts venue from labelled line', () => {
    expect(extractVenue(SPARK_BODY)?.value).toBe('Garibaldi');
  });

  it('extracts address', () => {
    expect(extractAddress(SPARK_BODY)?.value).toBe('36 Purvis Street, Singapore 188613');
  });

  it('extracts dress code', () => {
    expect(extractDressCode(SPARK_BODY)?.value).toBe('Business');
  });
});

describe('extractHighlights', () => {
  it('pulls bullet items below the "Key Program Highlights:" header', () => {
    expect(extractHighlights(SPARK_BODY)).toEqual([
      'Future of finance',
      'AI policy and regulation',
      'Cross-border ventures',
      'Q&A with the panel',
    ]);
  });

  it('returns empty array when no highlights header', () => {
    expect(extractHighlights('No highlights here.')).toEqual([]);
  });
});

describe('extractSpeakers', () => {
  it('extracts names from the "panel of speakers ... such as A, B and C" phrasing', () => {
    expect(extractSpeakers(SPARK_BODY)).toEqual(['Jane Doe', 'John Smith', 'Mei Lin']);
  });

  it('extracts from a labelled Speakers: line', () => {
    expect(extractSpeakers('Speakers: Alice, Bob and Carol')).toEqual(['Alice', 'Bob', 'Carol']);
  });
});

describe('extractRegistrationLink', () => {
  it('grabs bit.ly link', () => {
    expect(extractRegistrationLink(SPARK_BODY)).toBe('bit.ly/spark-feb-25');
  });
});

describe('extractEdmSummary / renderEdmSummary / summarizeEdm', () => {
  it('builds a structured summary from the SPARK body', () => {
    const s = extractEdmSummary(SPARK_BODY, 'Invitation to SPARK Lunch', 2025);
    expect(s.date_local).toBe('2025-02-27T12:00');
    expect(s.date_long).toMatch(/Thursday, 27 February 2025/);
    expect(s.time_str).toMatch(/12:00 PM to 2:00 PM/i);
    expect(s.venue).toBe('Garibaldi');
    expect(s.dress_code).toBe('Business');
    expect(s.speakers).toEqual(['Jane Doe', 'John Smith', 'Mei Lin']);
    expect(s.highlights.length).toBe(4);
    expect(s.registration).toBe('bit.ly/spark-feb-25');
  });

  it('renders only the fields that are present', () => {
    const out = renderEdmSummary({
      date_local: null,
      date_long: 'Thursday, 27 February 2025',
      time_str: null,
      venue: 'Garibaldi',
      address: null,
      dress_code: null,
      highlights: [],
      speakers: [],
      registration: null,
    });
    expect(out).toBe('Date: Thursday, 27 February 2025\nVenue: Garibaldi');
  });

  it('summarizeEdm: end-to-end', () => {
    const out = summarizeEdm(SPARK_BODY, 'Invitation to SPARK Lunch', 2025);
    expect(out).toMatch(/Date: Thursday, 27 February 2025/);
    expect(out).toMatch(/Venue: Garibaldi/);
    expect(out).toMatch(/Highlights:\n {2}• Future of finance/);
  });
});
