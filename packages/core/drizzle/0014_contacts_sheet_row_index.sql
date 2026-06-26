-- Store each contact's real 1-based row number from the source sheet (header
-- offset included), so the pulled list keeps the sheet's order and the serial
-- number shown matches the Google Sheets row gutter. Nullable; existing rows
-- and hand-added contacts get NULL until the next sheet sync backfills them.
ALTER TABLE `contacts` ADD COLUMN `sheet_row_index` integer;
