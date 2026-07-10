PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`program_id` integer NOT NULL,
	`is_system_wide` integer DEFAULT false NOT NULL,
	`type` text NOT NULL,
	`date` integer NOT NULL,
	`location` text,
	`starts_at` integer,
	`ends_at` integer,
	`cost` text,
	`what_to_bring` text,
	`changed_after_publish_fields` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_activities`("id", "program_id", "is_system_wide", "type", "date", "location", "starts_at", "ends_at", "cost", "what_to_bring", "changed_after_publish_fields", "created_at", "updated_at") SELECT "id", "program_id", "is_system_wide", "type", "date", "location", "starts_at", "ends_at", "cost", "what_to_bring", "changed_after_publish_fields", "created_at", "updated_at" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `programs` ADD `theme_image_path` text;--> statement-breakpoint
ALTER TABLE `programs` ADD `theme_title` text;