CREATE TABLE `message_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `invites` ADD `chauffeured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `parking_coupon` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `takes_bus` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invites` ADD `food_pref` text;