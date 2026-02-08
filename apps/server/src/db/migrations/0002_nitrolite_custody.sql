ALTER TABLE "yellow_sessions" ADD COLUMN "channel_id" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "custody_deposit_tx_hash" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "channel_close_tx_hash" text;
ALTER TABLE "yellow_sessions" ADD COLUMN "custody_withdraw_tx_hash" text;
