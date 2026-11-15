ALTER TABLE `decks` ADD `daily_new_limit_enabled` integer;
ALTER TABLE `decks` ADD `daily_new_limit` integer;
ALTER TABLE `decks` ADD `daily_review_limit_enabled` integer;
ALTER TABLE `decks` ADD `daily_review_limit` integer;

ALTER TABLE `decks_folders` ADD `daily_new_limit_enabled` integer;
ALTER TABLE `decks_folders` ADD `daily_new_limit` integer;
ALTER TABLE `decks_folders` ADD `daily_review_limit_enabled` integer;
ALTER TABLE `decks_folders` ADD `daily_review_limit` integer;
