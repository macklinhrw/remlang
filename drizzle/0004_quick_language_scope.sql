ALTER TABLE `decks` ADD `language_id` text;
--> statement-breakpoint
CREATE INDEX `decks_language_idx` ON `decks` (`language_id`);
--> statement-breakpoint
UPDATE `decks`
SET `language_id` = 'lang_zh'
WHERE `language_id` IS NULL;
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text
);
--> statement-breakpoint
INSERT OR IGNORE INTO `app_settings` (`key`, `value`)
VALUES ('active_language_id', 'lang_zh');
