-- Free mode: a SERP analysis remembers WHICH source it came from (DataForSEO or Serper.dev); search-volume rows already carry `provider` ('dataforseo' | 'csv').
ALTER TABLE serp_analyses ADD COLUMN provider text NOT NULL DEFAULT 'dataforseo';
