-- Per-event delegate tracker: a Google Sheet link the operator sets after the
-- event is created. A yes-confirmation shifts that delegate's row into the
-- confirmed block. Nullable; existing rows get NULL (no tracker).
ALTER TABLE `events` ADD COLUMN `delegate_sheet_url` text;
