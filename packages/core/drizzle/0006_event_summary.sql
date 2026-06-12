-- Adds events.edm_summary — compact "Event facts" block extracted from
-- the EDM body and used by the LLM when drafting WhatsApp invitations.
ALTER TABLE `events` ADD COLUMN `edm_summary` text;
