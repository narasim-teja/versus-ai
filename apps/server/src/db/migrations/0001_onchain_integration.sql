-- On-chain integration: video registry + cross-chain settlement

-- Videos table: denormalized agent fields + on-chain registration
ALTER TABLE "videos" ADD COLUMN "creator_wallet" text;
ALTER TABLE "videos" ADD COLUMN "creator_token_address" text;
ALTER TABLE "videos" ADD COLUMN "creator_bonding_curve_address" text;
ALTER TABLE "videos" ADD COLUMN "registry_tx_hash" text;
ALTER TABLE "videos" ADD COLUMN "registry_chain_id" integer;

-- Yellow sessions: agent fields + cross-chain settlement tx tracking
ALTER TABLE "yellow_sessions" ADD COLUMN "creator_token_address" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "creator_bonding_curve_address" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "settlement_tx_hash_base" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "bridge_tx_hash" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "distribution_tx_hash" text;
