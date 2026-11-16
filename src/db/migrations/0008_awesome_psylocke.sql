ALTER TABLE `leaders` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_method` text DEFAULT 'magic_link' NOT NULL;