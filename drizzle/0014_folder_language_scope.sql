ALTER TABLE `decks_folders` ADD `language_id` text REFERENCES languages(`id`);
CREATE INDEX `decks_folders_language_idx` ON `decks_folders` (`language_id`);
