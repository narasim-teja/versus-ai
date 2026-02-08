CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_address" text NOT NULL,
	"bonding_curve_address" text NOT NULL,
	"side" text NOT NULL,
	"trader" text NOT NULL,
	"usdc_amount" text NOT NULL,
	"token_amount" text NOT NULL,
	"price" text NOT NULL,
	"tx_hash" text,
	"block_number" integer,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"video_prompt" text,
	"thumbnail_prompt" text,
	"duration" integer,
	"video_id" text,
	"size_bytes" integer,
	"cost_estimate" text,
	"error" text,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "creator_wallet" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "creator_token_address" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "creator_bonding_curve_address" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "registry_tx_hash" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "registry_chain_id" integer;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "creator_token_address" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "creator_bonding_curve_address" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "settlement_tx_hash_base" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "bridge_tx_hash" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "distribution_tx_hash" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "custody_deposit_tx_hash" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "channel_close_tx_hash" text;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD COLUMN "custody_withdraw_tx_hash" text;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_trades_token" ON "trades" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "idx_trades_timestamp" ON "trades" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_video_generations_agent_id" ON "video_generations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_video_generations_status" ON "video_generations" USING btree ("status");