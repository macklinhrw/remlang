ALTER TABLE `review_log` ADD `created_at` text;
ALTER TABLE `review_log` ADD `updated_at` text;
UPDATE `review_log`
SET
	`created_at` = COALESCE(`created_at`, `review`),
	`updated_at` = COALESCE(`updated_at`, `review`);

CREATE TABLE `review_undo` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`review_log_id` text NOT NULL,
	`due` text NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`learning_steps` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'New' NOT NULL,
	`last_review` text NOT NULL,
	`undone` integer DEFAULT false NOT NULL,
	`invalidated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_log_id`) REFERENCES `review_log`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `review_undo_active_idx` ON `review_undo` (`invalidated`, `undone`, `created_at`);
CREATE INDEX `review_undo_knowledge_idx` ON `review_undo` (`knowledge_id`, `created_at`);
