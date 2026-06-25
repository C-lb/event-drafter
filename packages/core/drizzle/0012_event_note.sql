-- Free-text operator note for an event, editable sticky-note style on the
-- home dashboard. Nullable; existing rows get NULL.
ALTER TABLE `events` ADD COLUMN `note` text;
