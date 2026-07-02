import { describe, it, expect } from 'vitest';
import { buildTargetedFollowUpPrompt } from '../src/llm/prompts.js';

const event = { name: 'AI Summit', event_date: new Date('2026-08-01'), venue: 'Marina Bay' };
const contact = { first_name: 'Ada', last_name: 'Lovelace', remarks: null };
const style_guide = 'Warm and brief.';

describe('buildTargetedFollowUpPrompt', () => {
  it('tailored mode lists only the active logistics facts', () => {
    const p = buildTargetedFollowUpPrompt({
      event, contact, style_guide, mode: 'tailored',
      logistics: { food_pref: 'vegetarian', chauffeured: false, parking_coupon: true, takes_bus: false },
    });
    const text = p.user + JSON.stringify(p.system);
    expect(text).toContain('vegetarian');
    expect(text.toLowerCase()).toContain('parking');
    expect(text.toLowerCase()).not.toContain('shuttle'); // takes_bus off
    expect(text.toLowerCase()).not.toContain('chauffeur'); // chauffeured off
  });

  it('general mode omits the logistics block even if logistics are passed', () => {
    const p = buildTargetedFollowUpPrompt({
      event, contact, style_guide, mode: 'general',
      logistics: { food_pref: 'vegetarian', chauffeured: true, parking_coupon: true, takes_bus: true },
    });
    const text = p.user + JSON.stringify(p.system);
    expect(text).not.toContain('vegetarian');
    expect(text.toLowerCase()).not.toContain('parking coupon');
  });

  it('includes the contact name and style guide', () => {
    const p = buildTargetedFollowUpPrompt({ event, contact, style_guide, mode: 'general' });
    expect(p.user).toContain('Ada');
    expect(JSON.stringify(p.system)).toContain('Warm and brief.');
  });
});
