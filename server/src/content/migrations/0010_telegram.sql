-- Phase 7a: Telegram (commands and notifications). Telegram may deliver the same update again (a retry after a slow answer): the ids already handled are kept for a week.

CREATE TABLE telegram_updates (
  update_id   bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_state (                                           -- small facts the panel shows: the bot's name, the webhook address, the last delivery
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
