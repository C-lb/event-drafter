import { describe, it, expect } from 'vitest';
import { buildDraftPrompt, buildClassifyAndDraftPrompt, parseClassifyAndDraft } from '../src/llm/prompts.js';

const baseInput = {
  event: {
    name: 'Q3 Garden Lunch',
    event_date: new Date('2026-07-15T12:00:00Z'),
    venue: 'The Glasshouse, Singapore',
    edm_subject: 'Q3 Garden Lunch invitation',
    edm_body: 'Please join us for a curated afternoon...',
  },
  contact: {
    first_name: 'Ada',
    last_name: 'Lovelace',
    remarks: 'just exited her fintech startup',
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
      contact: { ...baseInput.contact, remarks: null },
      attendance_history: [],
    });
    expect(p.user).toContain('(no prior events on record)');
    expect(p.user).toContain('(none — keep the message warm but generic)');
  });

  it('uses first_name as the preferred name', () => {
    const p = buildDraftPrompt(baseInput);
    expect(p.user).toContain('Preferred name: Ada');
  });

  it('handles a contact with no last_name', () => {
    const p = buildDraftPrompt({
      ...baseInput,
      contact: { ...baseInput.contact, last_name: null },
    });
    expect(p.user).toContain('Full name: Ada');
    expect(p.user).not.toContain('Full name: Ada Lovelace');
  });
});

describe('parseClassifyAndDraft', () => {
  it('parses a happy-path JSON', () => {
    const raw = `{"classification":"yes","confidence":0.9,"summary":"accepted","response_draft":"Lovely, see you there."}`;
    const r = parseClassifyAndDraft(raw);
    expect(r.classification).toBe('yes');
    expect(r.confidence).toBe(0.9);
    expect(r.response_draft).toContain('see you there');
  });

  it('strips accidental ```json code fences', () => {
    const raw = "```json\n" + `{"classification":"no","confidence":0.7,"summary":"declined","response_draft":"Understood, hope to see you next time."}` + "\n```";
    const r = parseClassifyAndDraft(raw);
    expect(r.classification).toBe('no');
  });

  it('throws on invalid classification', () => {
    expect(() => parseClassifyAndDraft(`{"classification":"perhaps","confidence":0.5,"summary":"x","response_draft":"x"}`)).toThrow();
  });

  it('throws on confidence out of range', () => {
    expect(() => parseClassifyAndDraft(`{"classification":"yes","confidence":2,"summary":"x","response_draft":"x"}`)).toThrow();
  });

  it('throws on empty response_draft', () => {
    expect(() => parseClassifyAndDraft(`{"classification":"yes","confidence":0.9,"summary":"x","response_draft":""}`)).toThrow();
  });
});

describe('buildClassifyAndDraftPrompt', () => {
  it('includes contact + original invite + reply in user message', () => {
    const p = buildClassifyAndDraftPrompt({
      event: { name: 'Gala', event_date: new Date(), venue: null },
      contact: { first_name: 'Ada', last_name: null, remarks: 'pianist' },
      original_invite_text: 'Hi Ada, would love to see you at Gala…',
      reply_text: 'unfortunately out of town that weekend',
      style_guide: 'Brief and warm.',
    });
    expect(p.user).toContain('out of town');
    expect(p.user).toContain('Hi Ada');
    expect(p.system[0]?.cache_control?.type).toBe('ephemeral');
  });
});
