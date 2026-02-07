CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"circle_wallet_id" text,
	"evm_address" text NOT NULL,
	"token_address" text NOT NULL,
	"bonding_curve_address" text NOT NULL,
	"strategy_type" text NOT NULL,
	"strategy_config" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "circle_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"address" text NOT NULL,
	"blockchain" text DEFAULT 'ARC-TESTNET' NOT NULL,
	"wallet_set_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "decision_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"cycle" integer NOT NULL,
	"timestamp" bigint NOT NULL,
	"state_snapshot" text NOT NULL,
	"thinking" text NOT NULL,
	"actions" text NOT NULL,
	"execution_results" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"token_address" text NOT NULL,
	"token_name" text,
	"balance" text NOT NULL,
	"avg_buy_price" text NOT NULL,
	"total_cost_basis" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_sentiment" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset" text NOT NULL,
	"price" text NOT NULL,
	"price_change_24h" double precision,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_address" text NOT NULL,
	"price" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"source" text DEFAULT 'chain' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"duration_seconds" integer,
	"total_segments" integer,
	"quality" text DEFAULT '720p',
	"master_secret" text,
	"merkle_root" text,
	"merkle_tree_data" text,
	"content_uri" text,
	"thumbnail_uri" text,
	"created_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "viewer_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"viewer_address" text,
	"segments_accessed" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "yellow_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"viewer_address" text NOT NULL,
	"creator_address" text NOT NULL,
	"server_address" text NOT NULL,
	"total_deposited" text NOT NULL,
	"viewer_balance" text NOT NULL,
	"creator_balance" text NOT NULL,
	"segments_delivered" integer DEFAULT 0,
	"price_per_segment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settlement_tx_hash" text,
	"created_at" timestamp DEFAULT now(),
	"closed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "circle_wallets" ADD CONSTRAINT "circle_wallets_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_logs" ADD CONSTRAINT "decision_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_sessions" ADD CONSTRAINT "viewer_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yellow_sessions" ADD CONSTRAINT "yellow_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_decision_logs_agent_id" ON "decision_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_decision_logs_timestamp" ON "decision_logs" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_holdings_agent_id" ON "holdings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_market_sentiment_asset" ON "market_sentiment" USING btree ("asset");--> statement-breakpoint
CREATE INDEX "idx_price_history_token" ON "price_history" USING btree ("token_address");--> statement-breakpoint
CREATE INDEX "idx_videos_agent_id" ON "videos" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_videos_status" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_viewer_sessions_video_id" ON "viewer_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_viewer_sessions_expires" ON "viewer_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_yellow_sessions_video" ON "yellow_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_yellow_sessions_viewer" ON "yellow_sessions" USING btree ("viewer_address");--> statement-breakpoint
CREATE INDEX "idx_yellow_sessions_status" ON "yellow_sessions" USING btree ("status");