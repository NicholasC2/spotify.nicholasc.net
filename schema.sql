CREATE TABLE IF NOT EXISTS spotify_users (
    account_id TEXT PRIMARY KEY,
    refresh_token TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_spotify_users_account_id
    ON spotify_users(account_id);
