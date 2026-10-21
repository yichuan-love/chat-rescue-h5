'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert.deepEqual(duplicateIds, [], `duplicate ids: ${duplicateIds.join(', ')}`);

const refs = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const missingRefs = refs.filter((id) => !ids.includes(id));
assert.deepEqual(missingRefs, [], `missing ids: ${missingRefs.join(', ')}`);

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(scriptMatch, 'inline script not found');
new Function(scriptMatch[1]);

assert.ok(html.includes('accept="image/*"'), 'file input should accept images');
assert.ok(html.includes('id="textInput"'), 'text input should exist');
assert.ok(html.includes('id="micBtn"'), 'microphone button should exist');
assert.ok(html.includes('value="polite"'), 'polite persona should exist');
assert.ok(html.includes('value="funny"'), 'funny persona should exist');
assert.ok(html.includes('value="sassy"'), 'sassy persona should exist');
assert.ok(html.includes('id="refreshBtn"'), 'refresh replies button should exist');
assert.ok(html.includes('id="topicsBtn"'), 'topics button should exist');
assert.ok(html.includes('rel="manifest"'), 'manifest link should exist');
assert.ok(html.includes('serviceWorker.register("/sw.js")'), 'service worker should be registered');
assert.ok(html.includes('document.addEventListener("paste"'), 'global paste listener should exist');
assert.ok(html.includes('仅供娱乐，请勿上传包含真实姓名、电话等敏感信息的截图哦~'));

assert.equal(html.includes('localStorage'), false, 'must not use localStorage');
assert.equal(html.includes('sessionStorage'), false, 'must not use sessionStorage');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.ok(manifest.icons.length >= 2);
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\//, ''))), `missing icon: ${icon.src}`);
}

const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'service worker must skip API cache');
assert.ok(sw.includes("request.method !== 'GET'"), 'service worker must skip non-GET');

console.log(`html/pwa audit: ${ids.length} ids, ${refs.length} refs, manifest + sw OK`);
