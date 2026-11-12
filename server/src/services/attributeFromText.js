const { normText } = require('./categoryMatcher');

/**
 * Picks the value of a REQUIRED Trendyol attribute from the product's own title and description (no AI, free).
 *
 * The attribute's value list is the vocabulary: a value ("Kırmızı", "Pamuk", "Kadın", "5 Yıl") is chosen when its words stand in the
 * text one after the other. Turkish endings are tolerated (Kadın -> kadınlar, Pamuk -> pamuklu) but not guessed ("Deri" is not "derin").
 *
 *   title wins over description. Longer values hide the shorter ones they contain ("Açık Mavi" hides "Mavi"). When the title names exactly
 *   one value it is taken; when it names several, the choice is ambiguous and nothing is taken. Only when the title names none the
 *   description is read, where the value must be the only one named, or clearly the one named most often.
 *
 * This is deliberately careful - a wrong value is worse than an empty one (Trendyol rejects the product or lists it wrongly):
 *   - values that are only a code or a letter ("VE", "S") never match a word of a sentence ("ve")
 *   - values with signs that change the meaning ("6+ Yaş", "0-3 Ay", "A+++") are not matched from text
 *   - a value with a number ("38 cm", "5 Yıl", "3") is only taken when the attribute's own name stands next to it in the text
 *     ("genişlik 38 cm", "5 yıl garanti"), and never a number that belongs to a range ("3-6 yaş") or a size ("2x38 cm")
 *   - attributes that are about the seller, not the product (Menşei, Marka ...) are never read from text
 * Nothing is invented: no value in the list, no safe match -> no answer, and the attribute stays "missing" for the user.
 */

// Words that are values of many lists but say nothing when found in a text
const GENERIC = new Set(['belirtilmemis', 'diger', 'yok', 'var', 'evet', 'hayir', 'hepsi', 'standart', 'tek', 'cok', 'karisik', 'secenekli']);

// Attributes about the seller / the file, not the product: never read from the text (folded names)
const NEVER_FROM_TEXT = new Set(['mensei', 'marka', 'uretici', 'ithalatci', 'barkod', 'stok kodu']);

// Alternative words for values of common lists (folded Turkish letters), by the folded value name
const SYNONYMS = {
  'kadin': ['bayan', 'hanim'],
  'kiz cocuk': ['kiz cocugu'],
  'erkek cocuk': ['erkek cocugu', 'oglan'],
  'bebek': ['baby'],
  'cocuk': ['kids'],
};

// Words that stand next to a number when it belongs to an attribute (by the first word of the folded attribute name). Without an entry
// the attribute's own name words are used.
const ANCHORS = {
  'garanti': ['garanti'],
  'hacim': ['hacim', 'kapasite', 'litre'],
  'kapasite': ['kapasite', 'hacim'],
  'genislik': ['genislik', 'en'],
  'yukseklik': ['yukseklik', 'boy'],
  'uzunluk': ['uzunluk', 'boy'],
  'derinlik': ['derinlik'],
  'agirlik': ['agirlik', 'kilo'],
  'beden': ['beden', 'numara'],
  'numara': ['numara', 'beden'],
  'guc': ['guc', 'watt'],
  'yas': ['yas'],
  'kanat': ['kanat'],
};

// Endings that may follow a word in Turkish text (folded letters): optional plural + optional case / possessive / "-li" like ending
const ENDING = /^(lar|ler)?(i|u|in|un|nin|nun|si|su|li|lu|siz|suz|de|da|te|ta|den|dan|ten|tan|e|a|ye|ya|le|la|yle|yla|dir|dur|tir|tur|ki)?$/;

const isNum = (w) => /^\d+$/.test(w);

/** Folded words of a text; digits and letters are separated ("500ml" -> "500", "ml"). */
function words(text) {
  return normText(text).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(' ').filter(Boolean);
}

function sameWord(valueWord, textWord) {
  if (valueWord === textWord) return true;
  if (/\d/.test(valueWord) || valueWord.length < 4) return false;          // numbers and short words must be exact
  if (textWord.length > valueWord.length && textWord.startsWith(valueWord) && ENDING.test(textWord.slice(valueWord.length))) return true;
  // consonant softening before a vowel ending: genişlik -> genişliği, çocuk -> çocuğu
  if (valueWord.endsWith('k')) {
    const soft = `${valueWord.slice(0, -1)}g`;
    return textWord.length > soft.length && textWord.startsWith(soft) && ENDING.test(textWord.slice(soft.length));
  }
  return false;
}

/** Every place where the phrase (list of folded words) stands in the text words: [{ at }]. */
function findPhrase(phrase, textWords) {
  const hits = [];
  for (let i = 0; i + phrase.length <= textWords.length; i++) {
    let hit = true;
    for (let j = 0; j < phrase.length; j++) if (!sameWord(phrase[j], textWords[i + j])) { hit = false; break; }
    if (hit) { hits.push({ at: i }); i += phrase.length - 1; }
  }
  return hits;
}

/** Can this value be recognised in a sentence at all? */
function usable(rawName) {
  const raw = String(rawName || '');
  if (/[+\-/<>%≥≤]/.test(raw)) return false;                               // "6+ Yaş", "0-3 Ay", "S/M": the sign carries the meaning
  const w = words(raw);
  if (w.length === 0) return false;
  if (w.every((x) => GENERIC.has(x))) return false;
  if (w.join('').length <= 2 && !w.some(isNum)) return false;               // "VE", "S": a code, not a word
  return true;
}

/** Phrases that stand for a value: its own words, and the synonyms of its folded name. */
function phrasesOf(valueName) {
  if (!usable(valueName)) return [];
  const own = words(valueName);
  const out = [own];
  for (const syn of SYNONYMS[own.join(' ')] || []) out.push(words(syn));
  return out;
}

/** Words that must stand next to a number for this attribute (folded). */
function anchorsOf(attrName) {
  const w = words(attrName);
  if (w.length === 0) return [];
  return ANCHORS[w[0]] || w.filter((x) => x.length >= 4);
}

/** A number inside a range ("3-6 yaş") or a dimension ("2x38 cm") is not the attribute's value. */
function inCompound(textWords, at) {
  if (at > 0 && isNum(textWords[at - 1])) return true;
  if (at > 1 && textWords[at - 1] === 'x' && isNum(textWords[at - 2])) return true;
  return false;
}

function nearAnchor(textWords, from, to, anchors) {
  if (anchors.length === 0) return false;
  const lo = Math.max(0, from - 3); const hi = Math.min(textWords.length - 1, to + 3);
  for (let i = lo; i <= hi; i++) if (anchors.some((a) => sameWord(a, textWords[i]) || a === textWords[i])) return true;
  return false;
}

/** Hits of the values inside one text, with the values hidden by a longer value removed. */
function scan(values, textWords, attrName = '') {
  const anchors = anchorsOf(attrName);
  const hits = [];
  for (const v of values) {
    let best = null;
    for (const phrase of phrasesOf(v.name)) {
      const numeric = phrase.some(isNum);
      const found = findPhrase(phrase, textWords).filter((h) => !numeric || (!inCompound(textWords, h.at) && nearAnchor(textWords, h.at, h.at + phrase.length - 1, anchors)));
      if (found.length > 0 && (!best || found.length > best.count)) best = { value: v, at: found[0].at, count: found.length, size: phrase.length, phrase };
    }
    if (best) hits.push(best);
  }
  // "Açık Mavi" hides "Mavi": a shorter hit whose words all lie inside a longer hit's words is not a separate answer
  return hits.filter((h) => !hits.some((o) => o !== h && o.size > h.size && h.phrase.every((w) => o.phrase.some((x) => sameWord(w, x) || sameWord(x, w)))));
}

/**
 * @param def   { id, name, allowCustom, values: [{ id, name }] }  one required attribute with its list
 * @param title product title
 * @param description product description
 * @returns { valueId, valueName, from: 'title' | 'description' } or null
 */
function pickValue(def, title, description) {
  if (NEVER_FROM_TEXT.has(words(def.name).join(' '))) return null;
  const values = (def.values || []).filter((v) => v && v.name);
  if (values.length === 0) return null;

  const inTitle = scan(values, words(title), def.name);
  if (inTitle.length === 1) return { valueId: String(inTitle[0].value.id), valueName: inTitle[0].value.name, from: 'title' };
  if (inTitle.length > 1) return null;                                      // the title names several: ambiguous

  const inDesc = scan(values, words(description), def.name);
  if (inDesc.length === 1) return { valueId: String(inDesc[0].value.id), valueName: inDesc[0].value.name, from: 'description' };
  if (inDesc.length > 1) {
    const sorted = [...inDesc].sort((a, b) => b.count - a.count);
    if (sorted[0].count >= 2 && sorted[0].count >= 2 * sorted[1].count) return { valueId: String(sorted[0].value.id), valueName: sorted[0].value.name, from: 'description' };
  }
  return null;
}

module.exports = { pickValue, words, sameWord, scan, usable, anchorsOf, GENERIC, NEVER_FROM_TEXT };
