/**
 * What the keyword features need to know about "keyword data" whichever service it came from (an Apify actor, a pasted file ...): the countries that can be asked, the
 * record every source is turned into, the trend rule and the question test. Nothing here knows a vendor.
 */
const LOCATIONS = { US: 2840, GB: 2826, CA: 2124, AU: 2036 };       // the countries the platform works with (the number is only used as an identifier)
const COMP = { LOW: 0.2, MEDIUM: 0.5, HIGH: 0.8 };

const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** the one flat shape every source is turned into; a missing part stays null (never 0) */
const emptyRecord = (keyword = '') => ({ keyword: String(keyword).toLowerCase(), found: false, searchVolume: null, cpc: null, paidCompetition: null, competitionLevel: null, keywordDifficulty: null, intent: null, monthly: [], avgReferringDomains: null });

/** Last 3 months against the 3 months before, in percent; null when the history is too short or the earlier period had no searches. */
function trendPct(monthly) {
  const m = (monthly || []).filter((x) => x.searchVolume !== null && x.searchVolume !== undefined);
  if (m.length < 6) return null;
  const last = m.slice(-3).reduce((a, x) => a + x.searchVolume, 0); const prev = m.slice(-6, -3).reduce((a, x) => a + x.searchVolume, 0);
  if (prev <= 0) return null;
  return Math.round(((last - prev) / prev) * 1000) / 10;
}

const QUESTION = /^(what|how|why|when|where|who|whom|which|can|could|does|do|did|is|are|was|were|should|will|would)\b/i;
const isQuestion = (kw) => QUESTION.test(String(kw).trim());

module.exports = { LOCATIONS, COMP, num, emptyRecord, trendPct, isQuestion };
