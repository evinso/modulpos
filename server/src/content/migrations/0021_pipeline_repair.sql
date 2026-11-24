-- Repair of the first live run of the production line: the suitability step threw away ideas that HAD a full real score (73-76 against a minimum of 70) because the fresh-news lane flag
-- (set on every young idea, even a fully scored one) was taken for "no full score". Those ideas, and their topics, are opened again; their keyword data and SERP analyses are still there.
-- Only rows carrying the line's own wording of that reason are touched (a person's rejection never is).
UPDATE topics t SET status = 'new'
  FROM content_opportunities o
 WHERE o.topic_id = t.id AND o.status = 'rejected' AND o.ineligible_reason LIKE 'Üretim hattı: Tam puan çıkmadı%' AND t.status = 'rejected';
UPDATE content_opportunities SET status = 'new', ineligible_reason = '', updated_at = now()
 WHERE status = 'rejected' AND ineligible_reason LIKE 'Üretim hattı: Tam puan çıkmadı%';
