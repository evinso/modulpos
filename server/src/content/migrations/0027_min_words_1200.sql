-- Owner: "minimum 1200" (words: the number on the Otomatik Üretim card, 950 / 1050 until now). Raised where the production line has its own setting; never lowered (a higher value of the owner stays).
-- The factory value for projects without a saved one is 1200 in the code (settings.js).
UPDATE automation_settings
   SET value = jsonb_set(value, '{minWords}', '1200'::jsonb), updated_at = now()
 WHERE key = 'pipeline' AND COALESCE(NULLIF(value->>'minWords', '')::int, 0) < 1200;
