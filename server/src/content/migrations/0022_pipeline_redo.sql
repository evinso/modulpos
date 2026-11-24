-- Before an idea is thrown away or its draft archived the line tries ONCE more: a fresh draft, by another writer when there is one, told why the first one failed.
ALTER TABLE pipeline_runs ADD COLUMN rewrites integer NOT NULL DEFAULT 0,                 -- fresh drafts written for the CURRENT idea (reset with every new idea)
                          ADD COLUMN hints jsonb NOT NULL DEFAULT '{}';                   -- { provider, notes } for that second draft
