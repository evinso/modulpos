const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateIp, safeAxiosOptions } = require('../../src/utils/safeHttp');

test('private / internal addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
});
test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700::1']) assert.ok(!isPrivateIp(ip), ip);
});
test('dangerous URLs are rejected, normal ones accepted', () => {
  for (const u of ['http://localhost/x', 'http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://a/b']) assert.throws(() => safeAxiosOptions(u), u);
  assert.doesNotThrow(() => safeAxiosOptions('https://example.com/feed.xml'));
});
