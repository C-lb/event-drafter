-- Adds a per-reply "resolved" flag so the operator can hide threads they're
-- done with from the /replies feed without changing response_status.
ALTER TABLE `replies` ADD COLUMN `resolved` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `replies` ADD COLUMN `resolved_at` integer;
