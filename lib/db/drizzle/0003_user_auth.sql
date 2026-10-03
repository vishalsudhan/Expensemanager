CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_ip_address" varchar(64),
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_hash_shape_check" CHECK ("password_reset_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "password_reset_tokens_expiry_in_future_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" varchar(400),
	"ip_address" varchar(64),
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_token_hash_shape_check" CHECK ("sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sessions_expiry_in_future_check" CHECK ("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_not_blank_check" CHECK (length(trim("users"."email")) > 3),
	CONSTRAINT "users_email_shape_check" CHECK ("users"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "users_token_version_positive_check" CHECK ("users"."token_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" USING btree (lower("email"));