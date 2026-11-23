-- When WordPress was last asked what became of a post that is still a draft there, so the read-back does not ask about the same draft over and over. Additive only.
ALTER TABLE publications ADD COLUMN synced_at timestamptz;
