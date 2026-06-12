import { describe, it, expect } from 'vitest';
import { renderStarterDrafts } from '../src/edm-templates.js';
import type { EdmSummary } from '../src/edm-extract.js';

const SUMMARY: EdmSummary = {
  date_local: '2025-02-27T12:00',
  date_long: 'Thursday, 27 February 2025',
  time_str: '12:00 PM to 2:00 PM',
  venue: 'Garibaldi',
  address: '36 Purvis Street, Singapore 188613',
  dress_code: 'Business',
  highlights: ['Future of finance', 'AI policy and regulation'],
  speakers: ['Jane Doe', 'John Smith'],
  registration: 'bit.ly/spark-feb-25',
};

const INPUT = {
  event_name: 'SPARK Lunch',
  event_date: new Date('2025-02-27T12:00:00+08:00'),
  summary: SUMMARY,
  operator_first_name: 'Sara',
  operator_role: 'Community Manager @ SPARK',
};

describe('renderStarterDrafts', () => {
  it('returns 3 drafts: long invite, day-of reminder, gentle follow-up', () => {
    const drafts = renderStarterDrafts(INPUT);
    expect(drafts.map((d) => d.kind)).toEqual(['long_invite', 'day_of_reminder', 'gentle_follow_up']);
  });

  it('substitutes summary fields into the long invite', () => {
    const [long] = renderStarterDrafts(INPUT);
    expect(long?.body).toContain('SPARK Lunch');
    expect(long?.body).toContain('Thursday, 27 February 2025');
    expect(long?.body).toContain('12:00 PM to 2:00 PM');
    expect(long?.body).toContain('Garibaldi');
    expect(long?.body).toContain('Jane Doe and John Smith');
    expect(long?.body).toContain('• Future of finance');
    expect(long?.body).toContain('bit.ly/spark-feb-25');
    expect(long?.body).toContain('Regards,\nSara\nCommunity Manager @ SPARK');
    expect(long?.missing_facts).toEqual([]);
  });

  it('contains no em dashes, en dashes, or formal hedge phrasing', () => {
    for (const d of renderStarterDrafts(INPUT)) {
      expect(d.body).not.toMatch(/[—–]/);
      expect(d.body).not.toMatch(/We would be delighted|esteemed panel/);
    }
  });

  it('reminder includes every logistics line', () => {
    const reminder = renderStarterDrafts(INPUT)[1]!;
    for (const line of ['Date: Thursday, 27 February 2025', 'Time: 12:00 PM to 2:00 PM', 'Venue: Garibaldi', 'Address: 36 Purvis Street, Singapore 188613', 'Dress Code: Business']) {
      expect(reminder.body).toContain(line);
    }
  });

  it('reports missing facts as bracketed placeholders + missing list', () => {
    const partial: EdmSummary = { ...SUMMARY, address: null, dress_code: null };
    const reminder = renderStarterDrafts({ ...INPUT, summary: partial })[1]!;
    expect(reminder.body).toContain('Address: [address]');
    expect(reminder.body).toContain('Dress Code: [dress code]');
    expect(reminder.missing_facts).toEqual(['address', 'dress code']);
  });

  it('follow-up references the event but does not call out silence', () => {
    const followUp = renderStarterDrafts(INPUT)[2]!;
    expect(followUp.body).toContain('Just floating this back up');
    expect(followUp.body).not.toMatch(/didn'?t reply|haven'?t responded|no response/i);
  });
});
