CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`preferred_name` text,
	`phone_e164` text NOT NULL,
	`email` text,
	`personal_note` text,
	`interests` text,
	`relationship_notes` text,
	`sheet_row_hash` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_phone_idx` ON `contacts` (`phone_e164`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`event_date` integer NOT NULL,
	`venue` text,
	`edm_subject` text,
	`edm_body` text,
	`gmail_message_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `follow_ups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invite_id` integer NOT NULL,
	`draft_text` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`approved_at` integer,
	`sent_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`draft_text` text,
	`draft_generated_at` integer,
	`approved_at` integer,
	`sent_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`rsvp` text DEFAULT 'none' NOT NULL,
	`attended` integer DEFAULT false NOT NULL,
	`attended_notes` text,
	`generation_meta` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_event_contact_idx` ON `invites` (`event_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invite_id` integer NOT NULL,
	`wa_message_text` text NOT NULL,
	`wa_sent_at` integer NOT NULL,
	`detected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`classification` text,
	`classification_confidence` real,
	`classification_summary` text,
	`response_draft` text,
	`response_approved_at` integer,
	`response_sent_at` integer,
	`response_status` text DEFAULT 'pending',
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`run_after` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `jobs_status_runafter_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `wa_chat_cursors` (
	`contact_id` integer PRIMARY KEY NOT NULL,
	`last_seen_wa_sent_at` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
