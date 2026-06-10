import { describe, it, expect } from 'vitest';
import { buildDraftPrompt } from '../src/llm/prompts.js';

const baseInput = {
  event: {
    name: 'Q3 Garden Lunch',
    event_date: new Date('2026-07-15T12:00:00Z'),
    venue: 'The Glasshouse, Singapore',
    edm_subject: 'Q3 Garden Lunch invitation',
    edm_body: 'Please join us for a curated afternoon...',
  },
  contact: {
    full_name: 'Ada Lovelace',
    preferred_name: 'Ada',
    personal_note: 'just exited her fintech startup',
    interests: 'classical music, mathematics',
  },
  attendance_history: [
    {
      event_name: 'Spring Gala 2026',
      event_date: new Date('2026-03-01T18:00:00Z'),
      attended: true,
      notes: 'sat at table 4, enjoyed the cello set',
    },
  ],
  style_guide: 'Warm but brief. No emoji.',
  operator_first_name: 'Caleb',
};

describe('buildDraftPrompt', () => {
  it('produces a system block with cache_control ephemeral', () => {
    const p = buildDraftPrompt(baseInput);
    expect(p.system).toHaveLength(1);
    expect(p.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('includes the style guide and EDM in the system prompt', () => {
    const p = buildDraftPrompt(baseInput);
    expect(p.system[0]?.text).toContain('Warm but brief');
    expect(p.system[0]?.text).toContain('curated afternoon');
    expect(p.system[0]?.text).toContain('Q3 Garden Lunch');
  });

  it('contains contact + attendance in user message only', () => {
    const p = buildDraftPrompt(baseInput);
    expect(p.user).toContain('Ada Lovelace');
    expect(p.user).toContain('just exited her fintech startup');
    expect(p.user).toContain('Spring Gala 2026');
    expect(p.system[0]?.text).not.toContain('Ada Lovelace');
    expect(p.system[0]?.text).not.toContain('Spring Gala 2026');
  });

  it('handles missing optional fields gracefully', () => {
    const p = buildDraftPrompt({
      ...baseInput,
      contact: { ...baseInput.contact, personal_note: null, interests: null },
      attendance_history: [],
    });
    expect(p.user).toContain('(no prior events on record)');
    expect(p.user).toContain('(none — keep the message warm but generic)');
  });

  it('falls back to first word of full name when preferred_name missing', () => {
    const p = buildDraftPrompt({
      ...baseInput,
      contact: { ...baseInput.contact, preferred_name: null },
    });
    expect(p.user).toContain('Preferred name: Ada');
  });
});
