-- Performance indexes migration
-- Run this on the LIVE database to apply missing indexes
-- CONCURRENTLY means no table lock during creation

-- Users table indexes (critical for login/register speed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- Interactions compound index (critical for feed EXISTS subqueries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_lookup ON interactions(post_id, user_id, type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_interactions_user_id ON interactions(user_id);
