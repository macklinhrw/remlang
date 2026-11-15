ALTER TABLE `knowledge` ADD `config_signature` text DEFAULT '__all__' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge` ADD `definition_config` text;
--> statement-breakpoint
ALTER TABLE `knowledge` ADD `config_label` text;
--> statement-breakpoint
CREATE INDEX `knowledge_entry_review_config_idx` ON `knowledge` (`entry_id`,`review_type`,`config_signature`);
