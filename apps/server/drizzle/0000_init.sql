CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`plan` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`account_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`result` text NOT NULL,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`emitter_id` text NOT NULL,
	`pfx_ciphertext` blob NOT NULL,
	`password_ciphertext` blob NOT NULL,
	`wrapped_key` blob NOT NULL,
	`cnpj` text NOT NULL,
	`subject` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer NOT NULL,
	`fingerprint_sha256` text NOT NULL,
	`active` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`emitter_id`) REFERENCES `emitters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `emitters` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`cnpj` text NOT NULL,
	`company_name` text NOT NULL,
	`municipal_registration` text,
	`municipality` text NOT NULL,
	`simples_nacional` text NOT NULL,
	`simples_regime` text,
	`special_regime` text NOT NULL,
	`provider` text DEFAULT 'nacional' NOT NULL,
	`environment` text DEFAULT 'producao_restrita' NOT NULL,
	`dps_series` text NOT NULL,
	`next_dps_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emitters_cnpj_unique` ON `emitters` (`cnpj`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_account` ON `memberships` (`user_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`platform_role` text DEFAULT 'user' NOT NULL,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);