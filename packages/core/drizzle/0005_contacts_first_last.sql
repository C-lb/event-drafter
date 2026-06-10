PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `contacts_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	`phone_e164` text NOT NULL,
	`secondary_phone_e164` text,
	`email` text,
	`remarks` text,
	`sheet_row_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `contacts_new` (
	`id`, `first_name`, `last_name`, `phone_e164`, `secondary_phone_e164`,
	`email`, `remarks`, `sheet_row_hash`, `created_at`, `updated_at`
)
SELECT
	`id`,
	COALESCE(
		CASE WHEN instr(`full_name`, ' ') > 0
			THEN substr(`full_name`, 1, instr(`full_name`, ' ') - 1)
			ELSE `full_name`
		END,
		'Unknown'
	) AS `first_name`,
	CASE WHEN instr(`full_name`, ' ') > 0
		THEN trim(substr(`full_name`, instr(`full_name`, ' ') + 1))
		ELSE NULL
	END AS `last_name`,
	`phone_e164`,
	NULL AS `secondary_phone_e164`,
	`email`,
	CASE
		WHEN `personal_note` IS NOT NULL AND `interests` IS NOT NULL
			THEN `personal_note` || ' | ' || `interests`
		WHEN `personal_note` IS NOT NULL THEN `personal_note`
		WHEN `interests` IS NOT NULL THEN `interests`
		ELSE NULL
	END AS `remarks`,
	`sheet_row_hash`,
	`created_at`,
	`updated_at`
FROM `contacts`;
--> statement-breakpoint
DROP TABLE `contacts`;
--> statement-breakpoint
ALTER TABLE `contacts_new` RENAME TO `contacts`;
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_phone_idx` ON `contacts` (`phone_e164`);
--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'contacts_sheet';
--> statement-breakpoint
PRAGMA foreign_keys=ON;
