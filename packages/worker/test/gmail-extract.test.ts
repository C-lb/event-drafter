import { describe, it, expect } from 'vitest';
import { extractText, htmlToText } from '../src/google/gmail.js';

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('htmlToText', () => {
  it('preserves line breaks from block elements', () => {
    const html = '<p>Date: 27 Feb 2026</p><p>Venue: Garibaldi</p>';
    expect(htmlToText(html)).toBe('Date: 27 Feb 2026\nVenue: Garibaldi');
  });

  it('converts <br> to newline', () => {
    expect(htmlToText('Date: 27 Feb<br>Time: 12pm')).toBe('Date: 27 Feb\nTime: 12pm');
  });

  it('renders <li> as bullet with leading newline', () => {
    const html = '<ul><li>Future of finance</li><li>AI policy</li></ul>';
    expect(htmlToText(html)).toBe('• Future of finance\n• AI policy');
  });

  it('decodes common HTML entities', () => {
    expect(htmlToText('&nbsp;Q&amp;A&nbsp;at&nbsp;7pm')).toBe('Q&A at 7pm');
    expect(htmlToText('Caf&#233;')).toBe('Café');
    expect(htmlToText('Caf&#xe9;')).toBe('Café');
  });

  it('drops style and script blocks', () => {
    const html = '<style>p{color:red}</style>Date: 1 Jan<script>alert(1)</script>';
    expect(htmlToText(html)).toBe('Date: 1 Jan');
  });

  it('collapses spaces but never collapses newlines into spaces', () => {
    const html = '<p>Date:   1   Jan</p><p>Venue:   Foo</p>';
    expect(htmlToText(html)).toBe('Date: 1 Jan\nVenue: Foo');
  });
});

describe('extractText', () => {
  it('extracts text/plain at the top level', () => {
    const payload = {
      mimeType: 'text/plain',
      body: { data: b64url('Date: 27 Feb 2026\nVenue: Garibaldi') },
    };
    expect(extractText(payload)).toBe('Date: 27 Feb 2026\nVenue: Garibaldi');
  });

  it('prefers text/plain inside multipart/alternative', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('PLAIN: Venue: A') } },
        { mimeType: 'text/html', body: { data: b64url('<p>HTML: Venue: B</p>') } },
      ],
    };
    expect(extractText(payload)).toBe('PLAIN: Venue: A');
  });

  it('falls back to text/html when only HTML is present', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Venue: Foo</p><p>Time: 7pm</p>') } }],
    };
    expect(extractText(payload)).toBe('Venue: Foo\nTime: 7pm');
  });

  it('recurses into nested multipart (multipart/mixed → multipart/alternative)', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('Date: 1 Mar\nVenue: X') } },
            { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
          ],
        },
        { mimeType: 'application/pdf', filename: 'edm.pdf' },
      ],
    };
    expect(extractText(payload)).toBe('Date: 1 Mar\nVenue: X');
  });

  it('returns empty string when payload has no readable parts', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText({ mimeType: 'application/pdf' })).toBe('');
  });
});
