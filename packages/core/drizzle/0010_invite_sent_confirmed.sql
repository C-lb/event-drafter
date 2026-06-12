-- Distinguishes "WhatsApp visibly accepted this message" from "we clicked
-- send and hoped". Set by the worker when post-send verification sees the
-- draft as an outbound bubble without the pending clock. NULL on a `sent`
-- invite = unverified (manual Mark Sent, or rows sent before verification
-- existed).
ALTER TABLE `invites` ADD COLUMN `sent_confirmed_at` integer;
