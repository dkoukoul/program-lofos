PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer,
	`period_start` integer NOT NULL,
	`period_end` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`theme_color_override` text,
	`theme_image_path` text,
	`theme_title` text,
	`published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_programs`("id", "section_id", "period_start", "period_end", "status", "theme_color_override", "theme_image_path", "theme_title", "published_at", "created_at") SELECT "id", "section_id", "period_start", "period_end", "status", "theme_color_override", "theme_image_path", "theme_title", "published_at", "created_at" FROM `programs`;--> statement-breakpoint
DROP TABLE `programs`;--> statement-breakpoint
ALTER TABLE `__new_programs` RENAME TO `programs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;