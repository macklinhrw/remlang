CREATE TABLE `permanent_deletes` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`deleted_at` text NOT NULL
);
CREATE INDEX `permanent_deletes_entity_idx` ON `permanent_deletes` (`entity_type`, `entity_id`);
CREATE INDEX `permanent_deletes_deleted_at_idx` ON `permanent_deletes` (`deleted_at`);
