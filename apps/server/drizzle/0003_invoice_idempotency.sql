ALTER TABLE `invoices` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_emitter_idempotency_key` ON `invoices` (`emitter_id`,`idempotency_key`);