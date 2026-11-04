const prisma = require('../config/database');

/**
 * Forbidden-word engine for product titles and descriptions.
 *
 * Rule actions:
 *   replace – substitute the word with `replacement`
 *   remove  – delete the word
 *   block   – leave the text as is but mark the product as not sendable
 *             (the readiness validator refuses to send it to a marketplace)
 *
 * Matching is Unicode/Turkish aware: "word" mode only matches whole words
 * (JS \b does not understand ç ş ğ ı ö ü), and i/İ/ı/I are treated as equal
 * unless the rule is case-sensitive.
 */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function turkishFold(escaped) {
  // Makes the pattern match both dotted and dotless i in either case.
  return escaped.replace(/[iıİI]/g, (ch) => {
    if (ch === 'i' || ch === 'İ') return '[iİ]';
    return '[ıI]';
  });
}

function buildRegex(rule) {
  const raw = String(rule.pattern || '').trim();
  if (!raw) return null;
  let body = escapeRe(raw);
  if (!rule.caseSensitive) body = turkishFold(body);
  if (rule.matchType !== 'contains') body = `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
  try {
    return new RegExp(body, rule.caseSensitive ? 'gu' : 'giu');
  } catch {
    return null;
  }
}

function tidy(text) {
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

class ContentRuleSet {
  constructor(rules) {
    this.rules = rules
      .filter((r) => r.isActive !== false)
      .map((r) => ({ rule: r, re: buildRegex(r) }))
      .filter((x) => x.re);
  }

  get size() { return this.rules.length; }

  /** Applies replace/remove rules to one text. Returns { text, changed, blockedBy[] } */
  processText(text, field) {
    if (text === null || text === undefined || text === '') return { text, changed: false, blockedBy: [] };
    let out = String(text);
    let changed = false;
    const blockedBy = [];
    for (const { rule, re } of this.rules) {
      if (rule.field !== 'both' && rule.field !== field) continue;
      re.lastIndex = 0;
      if (!re.test(out)) continue;
      re.lastIndex = 0;
      if (rule.action === 'block') { blockedBy.push(rule.pattern); continue; }
      const repl = rule.action === 'remove' ? '' : (rule.replacement || '');
      out = out.replace(re, () => repl);
      changed = true;
    }
    if (changed) out = tidy(out);
    return { text: out, changed, blockedBy };
  }

  /** Used by the XML sync: { title, description } -> processed copy + blocked flag */
  apply({ title, description }) {
    const t = this.processText(title, 'title');
    const d = this.processText(description, 'description');
    return {
      title: t.text,
      description: d.text,
      changed: t.changed || d.changed,
      blocked: t.blockedBy.length > 0 || d.blockedBy.length > 0,
      blockedBy: [...new Set([...t.blockedBy, ...d.blockedBy])],
    };
  }

  /** Words that are still present and flagged as `block` (used by the readiness validator). */
  findBlocked({ title, description }) {
    const t = this.processText(title, 'title');
    const d = this.processText(description, 'description');
    return [...new Set([...t.blockedBy, ...d.blockedBy])];
  }
}

async function loadContentRules(storeId) {
  const rules = await prisma.contentRule.findMany({
    where: { isActive: true, OR: [{ storeId }, { storeId: null }] },
    orderBy: { createdAt: 'asc' },
  });
  return new ContentRuleSet(rules);
}

module.exports = { ContentRuleSet, loadContentRules, buildRegex };
