-- Adds a free-form progress text column so long-running jobs (notably
-- `check_replies`, which loops through every sent invite) can surface
-- per-iteration status to the dashboard. NULL when not in flight or when
-- the handler doesn't bother to write progress.
ALTER TABLE `jobs` ADD COLUMN `progress` text;
