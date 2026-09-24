CREATE TABLE `system_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`text` text NOT NULL,
	`date_start` integer NOT NULL,
	`date_end` integer NOT NULL,
	`changed_after_publish` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE no action
);
