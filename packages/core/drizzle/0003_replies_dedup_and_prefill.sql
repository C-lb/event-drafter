ALTER TABLE `replies` ADD `wa_message_id` text;--> statement-breakpoint
ALTER TABLE `replies` ADD `response_prefilled_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `replies_invite_msg_idx` ON `replies` (`invite_id`,`wa_message_id`);