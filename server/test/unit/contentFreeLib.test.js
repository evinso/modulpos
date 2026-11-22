const test = require('node:test');
const assert = require('node:assert/strict');
const serper = require('../../src/content/services/serper');
const { parseKeywordFile, parseVolume, parseMoney, parseCompetition } = require('../../src/content/lib/keywordFile');

const NOW = new Date('2026-11-21T12:00:00Z');

test('serper: result dates as the page shows them become ISO times; anything else is null (never guessed)', () => {
  assert.equal(serper.parseResultDate('3 days ago', NOW), '2026-11-18T12:00:00.000Z');
  assert.equal(serper.parseResultDate('5 hours ago', NOW), '2026-11-21T07:00:00.000Z');
  assert.equal(serper.parseResultDate('1 month ago', NOW), '2026-10-22T12:00:00.000Z');
  assert.equal(serper.parseResultDate('Mar 10, 2022', NOW), '2022-03-10T00:00:00.000Z');
  for (const x of ['', null, undefined, 'yesterday', 'Last week', '2022-03-10', 'Foo 3, 2025', 'Mar 45, 2025']) assert.equal(serper.parseResultDate(x, NOW), null, String(x));
});

test('serper: the answer becomes the flat shape the SERP score reads (www dropped, only web links, features named, credits as units, cost unknown)', () => {
  const n = serper.normalize({
    organic: [{ title: 'A', link: 'https://www.Example.com/a', snippet: 's', position: 1, date: '2 days ago' }, { title: 'B', link: 'javascript:alert(1)', position: 2 }, { title: 'C', link: 'https://blog.test/c' }, { title: 'no link' }],
    peopleAlsoAsk: [{ question: 'Why?' }, {}], relatedSearches: [{ query: 'foo' }, { nope: 1 }], answerBox: { title: 'x' }, knowledgeGraph: { title: 'k' }, images: [], credits: 2 }, { now: NOW });
  assert.deepEqual(n.organic.map((o) => [o.rank, o.domain, o.url]), [[1, 'example.com', 'https://www.Example.com/a'], [2, '', ''], [3, 'blog.test', 'https://blog.test/c']].map(([r, d, u], i) => (i === 1 ? [2, '', ''] : [r, d, u])), 'a non-web link has no domain and no url');
  assert.equal(n.organic[0].timestamp, '2026-11-19T12:00:00.000Z'); assert.equal(n.organic[2].timestamp, null); assert.equal(n.organic[2].rank, 3, 'a missing position is the index');
  assert.deepEqual(n.questions, ['Why?']); assert.deepEqual(n.related, ['foo']); assert.deepEqual(n.features, ['featured_snippet', 'knowledge_graph', 'people_also_ask'], 'an empty images list is not a feature');
  assert.deepEqual([n.cost, n.units, n.empty, n.resultsCount], [null, 2, false, null]);
  assert.deepEqual([serper.normalize(null).empty, serper.normalize({}).units, serper.normalize({ organic: 'x' }).organic.length], [true, 1, 0]);
});

test('serper client: sends the key in the header, reads refusals from the status, and a timeout may have been billed', async () => {
  const calls = [];
  const reply = (status, body) => async (url, o) => { calls.push({ url, o }); return { ok: status < 300, status, json: async () => body }; };
  const ok = await serper.createClient({ apiKey: 'k'.repeat(20), fetchImpl: reply(200, { organic: [{ link: 'https://a.test/x', title: 'x', position: 1 }] }) }).serpOrganic({ keyword: 'gemini 3', country: 'GB', language: 'en', now: NOW });
  assert.equal(ok.organic.length, 1); assert.equal(calls[0].url, 'https://google.serper.dev/search'); assert.equal(calls[0].o.headers['X-API-KEY'], 'k'.repeat(20)); assert.deepEqual(JSON.parse(calls[0].o.body), { q: 'gemini 3', gl: 'gb', hl: 'en', num: 10 });
  const fail = async (status, body, re, code) => { await assert.rejects(serper.createClient({ apiKey: 'k'.repeat(20), fetchImpl: reply(status, body) }).serpOrganic({ keyword: 'x' }), (e) => e.code === code && re.test(e.message)); };
  await fail(401, {}, /reddedildi/, 'auth'); await fail(403, {}, /reddedildi/, 'auth'); await fail(429, {}, /sınırı/, 'rate_limit'); await fail(400, { message: 'Not enough credits' }, /kredisi bitti/, 'funds');
  await fail(400, { message: 'bad query' }, /HTTP 400.*bad query/, 'http'); await fail(500, {}, /HTTP 500/, 'http');
  await assert.rejects(serper.createClient({ apiKey: 'k'.repeat(20), fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }) }).serpOrganic({ keyword: 'x' }), (e) => e.code === 'bad_answer');
  await assert.rejects(serper.createClient({ apiKey: 'k'.repeat(20), fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } }).serpOrganic({ keyword: 'x' }), (e) => e.code === 'timeout' && e.maybeBilled === true);
  await assert.rejects(serper.createClient({ apiKey: 'k'.repeat(20), fetchImpl: async () => { throw new Error('dns'); } }).serpOrganic({ keyword: 'x' }), (e) => e.code === 'network' && e.maybeBilled === true);
  assert.throws(() => serper.createClient({ apiKey: '' }), /anahtarı gerekli/);
});

test('volume file: only an EXACT number is a volume; ranges, rounded values and blanks are named, never turned into numbers', () => {
  const k = (x) => parseVolume(x).kind; const v = (x) => parseVolume(x).value;
  for (const [x, n] of [['1200', 1200], ['1,200', 1200], ['1.200', 1200], ['1 200', 1200], [' 880 ', 880], ['0', 0], ['12,345,678', 12345678], ['+50', 50]]) assert.deepEqual([k(x), v(x)], ['exact', n], x);
  for (const x of ['1K – 10K', '100 - 1000', '1K-10K', '10 to 100', '10K–100K']) assert.equal(k(x), 'range', x);
  for (const x of ['10K', '1.2M', '5k']) assert.equal(k(x), 'rounded', x);
  for (const x of ['', ' ', '-', '—', 'n/a', 'N/A', null, undefined]) assert.equal(k(x), 'empty', String(x));
  for (const x of ['abc', '1,5', '12.5', '1,2345']) assert.equal(k(x), 'bad', x);
  assert.deepEqual([parseMoney('$1.25'), parseMoney('1,25'), parseMoney('1,200.50'), parseMoney('-'), parseMoney('abc'), parseMoney('5000')], [1.25, 1.25, 1200.5 > 1000 ? null : 1200.5, null, null, null]);
  assert.deepEqual([parseCompetition('Low'), parseCompetition('HIGH'), parseCompetition('0.35'), parseCompetition('45'), parseCompetition('45', { indexed: true }), parseCompetition('-'), parseCompetition('150')],
    [{ level: 'LOW', value: 0.2 }, { level: 'HIGH', value: 0.8 }, { level: null, value: 0.35 }, { level: null, value: 0.45 }, { level: null, value: 0.45 }, { level: null, value: null }, { level: null, value: null }]);
});

test('volume file: Keyword Planner export (title lines, tab separated, indexed competition, monthly columns) is read as it comes', () => {
  const text = ['﻿Keyword Stats 2026-11-21 at 10_00_00', 'Nov 2025 - Oct 2026', ['Keyword', 'Currency', 'Avg. monthly searches', 'Competition', 'Competition (indexed value)', 'Searches: Nov 2025', 'Searches: Dec 2025'].join('\t'),
    ['chatgpt update', 'USD', '12100', 'Low', '12', '10000', '14000'].join('\t'), ['windows 11', 'USD', '1K – 10K', 'High', '80', '', ''].join('\t'), ['', 'USD', '100', '', '', '', ''].join('\t'), ['12345', 'USD', '100', '', '', '', ''].join('\t')].join('\r\n');
  const r = parseKeywordFile(text);
  assert.equal(r.delimiter, 'tab'); assert.equal(r.hasHeader, true); assert.deepEqual(r.columns, { keyword: true, volume: true, cpc: false, competition: true, difficulty: false, monthlyMonths: 2 });
  assert.equal(r.rows.length, 1); assert.deepEqual([r.rows[0].keyword, r.rows[0].volume, r.rows[0].competition, r.rows[0].competitionLevel], ['chatgpt update', 12100, 0.12, 'LOW']);
  assert.deepEqual(r.rows[0].monthly, [{ year: 2025, month: 11, searchVolume: 10000 }, { year: 2025, month: 12, searchVolume: 14000 }]);
  assert.deepEqual(r.skipped, { range: 1, rounded: 0, empty: 0, bad: 0, noKeyword: 2 }, 'a blank keyword and a number without letters are damaged rows'); assert.deepEqual(r.examples.range, ['windows 11']);
});

test('volume file: other layouts (comma with quotes, semicolon, extra columns, no header, header names of other tools) and the refusals', () => {
  const c = parseKeywordFile('Keyword,Volume,CPC,KD,Notes\n"best, cheap vpn","1,200",$1.25,45%,"line one\nline two"\nplain,300,,,\n');
  assert.deepEqual(c.rows.map((x) => [x.keyword, x.volume, x.cpc, x.difficulty]), [['best, cheap vpn', 1200, 1.25, 45], ['plain', 300, null, null]]);
  const s = parseKeywordFile('Search term;Search Volume\nfoo bar;"1.200"\nbaz;7'); assert.deepEqual([s.delimiter, s.rows.map((x) => x.volume)], [';', [1200, 7]]);
  const h = parseKeywordFile('chatgpt plus,5400\ngemini 3,880'); assert.deepEqual([h.hasHeader, h.rows.map((x) => [x.keyword, x.volume])], [false, [['chatgpt plus', 5400], ['gemini 3', 880]]]);
  assert.throws(() => parseKeywordFile('foo,bar\n1,2'), (e) => e.code === 'format' && /Anahtar kelime sütunu/.test(e.message), 'an unknown header is never imported as data');
  assert.throws(() => parseKeywordFile('Keyword\nfoo'), (e) => e.code === 'format' && /Hacim sütunu/.test(e.message));
  assert.throws(() => parseKeywordFile('a\u0000b'), (e) => e.code === 'encoding');
  assert.throws(() => parseKeywordFile('keyword,volume\n' + Array.from({ length: 5 }, (_, i) => `w${i} x,${i}`).join('\n'), { maxRows: 3 }), (e) => e.code === 'too_many');
  const dup = parseKeywordFile('keyword,volume\nsame thing,10\nsame thing,20'); assert.equal(dup.rows.length, 2, 'the file reader keeps every row; the import keeps the later one');
});
