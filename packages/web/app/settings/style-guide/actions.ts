'use server';

import { z } from 'zod';
import { getSetting, setSetting } from '@event-drafter/core/settings';

const DEFAULT_GUIDE = `Tone: warm but brief. Write the way you would to a friend who happens to also be a senior business contact.
Length: 2-4 sentences. Never longer.
Open with a single personal beat (the supplied hook), then the invite, then a soft close.
Avoid:
- Generic marketing phrases ("excited to invite", "amazing opportunity")
- Exclamation marks
- Emoji
- Restating the formal EDM verbatim
Sign-off: just your first name, no title.`;

export async function getStyleGuide(): Promise<string> {
  return getSetting('style_guide') ?? DEFAULT_GUIDE;
}

const schema = z.object({ value: z.string().min(20).max(4000) });

export async function saveStyleGuide(input: unknown) {
  const { value } = schema.parse(input);
  setSetting('style_guide', value);
}
