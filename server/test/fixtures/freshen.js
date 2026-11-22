/**
 * The real feeds in test/fixtures/content were captured on a fixed day, but the news module only keeps recent headlines (72 hours by default) and the HTTP / panel tests
 * run it on the REAL clock. Without this they would start failing a few days after the capture (and on CI). `freshen` moves every date of a feed by the same amount so
 * that the newest item is `ageMinutes` old: the order and the spacing of the items (what the tests are about) stay exactly as captured.
 */
const TAGS = ['pubDate', 'published', 'updated', 'dc:date', 'lastBuildDate'];
const RE = new RegExp(`<(${TAGS.join('|')})>([^<]+)</\\1>`, 'g');

function freshen(xml, { now = new Date(), ageMinutes = 60 } = {}) {
  const text = String(xml);
  let newest = -Infinity;
  for (const m of text.matchAll(RE)) { const t = Date.parse(m[2].trim()); if (Number.isFinite(t) && t > newest) newest = t; }
  if (!Number.isFinite(newest)) return text;
  const delta = now.getTime() - ageMinutes * 60000 - newest;
  return text.replace(RE, (all, tag, val) => {
    const t = Date.parse(val.trim()); if (!Number.isFinite(t)) return all;
    const d = new Date(t + delta); return `<${tag}>${/^\d{4}-\d\d-\d\d/.test(val.trim()) ? d.toISOString() : d.toUTCString()}</${tag}>`;
  });
}

module.exports = { freshen };
