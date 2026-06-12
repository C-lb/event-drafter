-- Per-event, per-template body overrides for the starter draft cards on
-- /events/[id]. JSON shape: { long_invite?: string, day_of_reminder?: string,
-- gentle_follow_up?: string }. NULL means "use the rendered template".
ALTER TABLE `events` ADD COLUMN `draft_overrides` text;
