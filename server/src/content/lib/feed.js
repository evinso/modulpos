const { XMLParser } = require('fast-xml-parser');
const { htmlToText } = require('./html');
const { clip, stripPublisher } = require('./text');

/**
 * RSS 2.0 / Atom / RSS 1.0 (RDF) and GDELT JSON -> one list of headlines.
 * Only what a reader needs is kept: headline, link, source, date and a SHORT summary (400 characters). Full texts are never stored (copyright).
 */
const MAX_ITEMS = 100;
const SUMMARY_MAX = 400;

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true,
  processEntities: true, htmlEntities: true, removeNSPrefix: false,
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
});

const text = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text']);
  return '';
};
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function absoluteUrl(href, base) {
  try { const u = new URL(String(href || '').trim(), base || undefined); return /^https?:$/.test(u.protocol) ? u.toString() : ''; } catch { return ''; }
}

function date(v) {
  const s = oneLine(text(v)); if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function atomLink(links, base) {
  const list = (Array.isArray(links) ? links : [links]).filter(Boolean);
  const pick = list.find((l) => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate')) || list[0];
  if (!pick) return '';
  return absoluteUrl(typeof pick === 'object' ? pick['@_href'] || pick['#text'] : pick, base);
}

function summaryOf(raw) { return clip(htmlToText(text(raw)), SUMMARY_MAX); }

/** @param xml the feed text  @param baseUrl the feed's own address (to resolve relative links) @returns { title, items: [{ title, url, guid, publishedAt, summary, author, sourceName, sourceUrl }] } */
function parseFeed(xml, baseUrl = '') {
  const doc = parser.parse(String(xml || '').replace(/^﻿/, ''));
  let channelTitle = ''; let raw = [];
  if (doc.rss && doc.rss.channel) { const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel; channelTitle = text(ch.title); raw = ch.item || []; }
  else if (doc.feed) { channelTitle = text(doc.feed.title); raw = doc.feed.entry || []; }
  else if (doc['rdf:RDF']) { const r = doc['rdf:RDF']; channelTitle = text(r.channel && r.channel.title); raw = r.item || []; }
  else throw new Error('Bu bir RSS/Atom yayını gibi görünmüyor');
  const items = [];
  for (const it of raw.slice(0, MAX_ITEMS * 2)) {
    const isAtom = !!doc.feed;
    const sourceNode = it.source && !Array.isArray(it.source) ? it.source : null;      // Google News: <source url="…">Publisher</source>
    const sourceName = sourceNode ? oneLine(text(sourceNode)) : '';
    let title = oneLine(text(it.title));
    const url = isAtom ? atomLink(it.link, baseUrl) : absoluteUrl(text(Array.isArray(it.link) ? it.link.map(text).find(Boolean) : it.link) || (it.guid && (it.guid['@_isPermaLink'] !== 'false') ? text(it.guid) : ''), baseUrl);
    if (!title || !url) continue;
    if (sourceName) title = stripPublisher(title, sourceName);
    const authorNode = it.author || it['dc:creator'];
    items.push({
      title: title.slice(0, 300), url, guid: oneLine(text(it.guid || it.id)).slice(0, 500) || url,
      publishedAt: date(it.pubDate || it.published || it.updated || it['dc:date']),
      summary: summaryOf(it.description || it.summary || ''), author: oneLine(text(authorNode && authorNode.name ? authorNode.name : authorNode)).slice(0, 120),
      sourceName: sourceName.slice(0, 120), sourceUrl: sourceNode ? absoluteUrl(sourceNode['@_url']) : '',
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return { title: oneLine(channelTitle).slice(0, 200), items };
}

const COUNTRY = { 'united states': 'US', 'united kingdom': 'GB', canada: 'CA', australia: 'AU', india: 'IN', germany: 'DE', france: 'FR', ireland: 'IE', 'new zealand': 'NZ', singapore: 'SG' };

/** GDELT DOC 2.0 "artlist" JSON (seendate = YYYYMMDDTHHMMSSZ). */
function parseGdelt(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const items = [];
  for (const a of (data && data.articles) || []) {
    const url = absoluteUrl(a.url); const title = oneLine(a.title);
    if (!url || !title) continue;
    const m = String(a.seendate || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    items.push({ title: title.slice(0, 300), url, guid: url, publishedAt: m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null, summary: '', author: '',
      sourceName: oneLine(a.domain).slice(0, 120), sourceUrl: '', country: COUNTRY[String(a.sourcecountry || '').toLowerCase()] || '', language: /english/i.test(a.language || '') ? 'en' : '' });
    if (items.length >= MAX_ITEMS) break;
  }
  return { title: 'GDELT', items };
}

/** Google News search feed address for a query ("when:1d" style operators allowed). */
function googleNewsUrl(query, { country = 'US', language = 'en' } = {}) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${language}-${country}&gl=${country}&ceid=${country}:${language}`;
}
function gdeltUrl(query, { maxRecords = 75, timespan = '1d' } = {}) {
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${query} sourcelang:english`)}&mode=artlist&format=json&maxrecords=${maxRecords}&sort=datedesc&timespan=${timespan}`;
}

module.exports = { parseFeed, parseGdelt, googleNewsUrl, gdeltUrl, MAX_ITEMS };
