ALTER TABLE `knowledge` ADD `learning_steps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `review_log` ADD `learning_steps` integer DEFAULT 0 NOT NULL;
