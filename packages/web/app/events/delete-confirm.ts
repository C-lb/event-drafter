// Single source of truth for the event-deletion confirm phrase.
// Both the server action (deleteEvent) and the client card (EventCard) import
// this so the required phrase and the phrase the UI gates on can never drift.
// It lives in its own module because actions.ts is `'use server'` and may only
// export async functions.
export const DELETE_CONFIRM_PHRASE = 'XXX';
