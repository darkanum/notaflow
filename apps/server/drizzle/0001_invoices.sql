CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`emitter_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document` text,
	`name` text NOT NULL,
	`municipal_registration` text,
	`address` text,
	`email` text,
	`phone` text,
	`origin` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`manual_fields` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_emitter_document` ON `customers` (`emitter_id`,`document_type`,`document`);--> statement-breakpoint
CREATE TABLE `invoice_events` (
	`id` text PRIMARY KEY NOT NULL,
	`emitter_id` text NOT NULL,
	`invoice_id` text,
	`access_key` text NOT NULL,
	`code` text NOT NULL,
	`reason_code` text,
	`justification` text,
	`registered_at` integer NOT NULL,
	`xml_gzip` blob NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_events_key_code` ON `invoice_events` (`access_key`,`code`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`emitter_id` text NOT NULL,
	`customer_id` text,
	`access_key` text,
	`number` text,
	`dps_id` text,
	`dps_series` text NOT NULL,
	`dps_number` integer NOT NULL,
	`status` text NOT NULL,
	`environment` text NOT NULL,
	`issued_at` integer,
	`competence` text NOT NULL,
	`customer_document` text,
	`customer_name` text,
	`service_code` text NOT NULL,
	`description` text NOT NULL,
	`service_cents` integer NOT NULL,
	`iss_cents` integer,
	`net_cents` integer NOT NULL,
	`origin` text NOT NULL,
	`template_of` text,
	`xml_gzip` blob,
	`sefin_messages` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_access_key_unique` ON `invoices` (`access_key`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`emitter_id` text NOT NULL,
	`environment` text NOT NULL,
	`last_nsu` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	PRIMARY KEY(`emitter_id`, `environment`),
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action
);
