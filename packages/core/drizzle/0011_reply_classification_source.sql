-- Tracks whether a reply's classification came from the LLM or was set by the
-- operator by hand. Manual overrides pin confidence to 1 and trigger a fresh
-- response draft keyed off the chosen judgement. Existing rows are 'llm'.
ALTER TABLE `replies` ADD COLUMN `classification_source` text NOT NULL DEFAULT 'llm';
