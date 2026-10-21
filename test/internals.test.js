'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _internals } = require('../server');

const {
  cleanText,
  cleanInputText,
  charLength,
  isValidImageDataUrl,
  parseAnalysisContent,
  parseTopicsContent,
  normalizeConversationAnalysis,
  normalizeEmotion,
  normalizeReplies,
  normalizeMeme,
  normalizeTopics,
  isConcurrencyError,
  normalizeApiKey,
  splitZhipuApiKey,
  createZhipuJwt,
  buildZhipuAuthorization,
  buildAnalysisSystemPrompt,
} = _internals;

// 静态校验：dotenv 必须在任何 process.env 读取之前；Authorization 必须是 Bearer + 空格。
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const dotenvIndex = serverSource.indexOf("require('dotenv').config()");
const firstEnvIndex = serverSource.indexOf('process.env');
assert.ok(dotenvIndex >= 0, 'dotenv config not found');
assert.ok(firstEnvIndex >= 0, 'process.env not found');
assert.ok(dotenvIndex < firstEnvIndex, 'dotenv must load before the first process.env read');
assert.ok(
  serverSource.includes('Authorization: `Bearer ${authToken}`'),
  'Authorization header must be "Bearer " + token',
);

assert.equal(cleanText('a\u0000b  c', 20), 'a b c');
assert.equal(cleanText('  多  余\n空白  ', 20), '多 余 空白');
assert.equal(cleanText('x'.repeat(50), 10), 'x'.repeat(10));
assert.equal(cleanInputText('第一行\r\n第二行'), '第一行\n第二行');
assert.equal(charLength('你好🙂'), 3);

assert.equal(normalizeApiKey('  abc.def  '), 'abc.def');
assert.equal(normalizeApiKey('Bearer abc.def'), 'abc.def');
assert.equal(normalizeApiKey('  Bearer   abc.def  '), 'abc.def');
assert.equal(normalizeApiKey('"abc.def"'), 'abc.def');
assert.equal(normalizeApiKey("'abc.def'"), 'abc.def');

const parts = splitZhipuApiKey('test-id.test-secret');
assert.deepEqual(parts, { id: 'test-id', secret: 'test-secret' });
assert.equal(splitZhipuApiKey('no-dot-key'), null);

const fixedNow = 1700000000000;
const jwt = createZhipuJwt('test-id.test-secret', { now: fixedNow, ttlSeconds: 3600 });
const segments = jwt.split('.');
assert.equal(segments.length, 3);

const jwtHeader = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'));
assert.equal(jwtHeader.alg, 'HS256');
assert.equal(jwtHeader.typ, 'JWT');
assert.equal(jwtHeader.sign_type, 'SIGN');

const jwtPayload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
assert.equal(jwtPayload.api_key, 'test-id');
assert.equal(jwtPayload.timestamp, fixedNow);
assert.equal(jwtPayload.exp, fixedNow + 3600 * 1000);

const expectedSignature = crypto
  .createHmac('sha256', 'test-secret')
  .update(`${segments[0]}.${segments[1]}`)
  .digest('base64url');
assert.equal(segments[2], expectedSignature);

assert.equal(buildZhipuAuthorization('test-id.test-secret', { mode: 'auto' }).mode, 'jwt');
assert.equal(buildZhipuAuthorization('plain-key', { mode: 'auto' }).mode, 'raw');
assert.equal(buildZhipuAuthorization('test-id.test-secret', { mode: 'raw' }).mode, 'raw');
assert.throws(
  () => buildZhipuAuthorization('plain-key', { mode: 'jwt' }),
  /id\.secret/,
);

assert.equal(
  isValidImageDataUrl(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  ),
  true,
);
assert.equal(isValidImageDataUrl('data:image/svg+xml;base64,abc'), false);
assert.equal(isValidImageDataUrl('data:text/plain;base64,abc'), false);
assert.equal(isValidImageDataUrl('data:image/jpeg;base64,not valid!'), false);

const sample = {
  jargon_analysis: [
    { term: 'API', plain: '软件之间传数据的接口。', context: '这里指调用接口。' },
  ],
  conversation_analysis: {
    summary: '对方在找理由结束话题',
    subtext: '不是没空，是不太想继续',
    dynamic: '你现在偏被动',
    advice: '给台阶，先收一下',
  },
  emotion: { other: '对方有点冷', me: '你现在偏被动', summary: '气氛偏冷，别急着追问' },
  replies: [
    { style: '得体', text: '好，那你先忙，忙完再说。' },
    { style: '幽默', text: '收到，我先去表情包库补货。' },
    { style: '高冷', text: '行，等你有空再聊。' },
  ],
  meme: { name: '猫猫探头', description: '猫猫从屏幕边缘探出来。', usage: '冷场时发一下。' },
};

const fenced = ['```json', JSON.stringify(sample), '```'].join('\n');
const parsed = parseAnalysisContent(fenced);
assert.equal(parsed.jargon_analysis[0].term, 'API');
assert.equal(parsed.conversation_analysis.summary, '对方在找理由结束话题');
assert.equal(parsed.conversation_analysis.advice, '给台阶，先收一下');
assert.equal(parsed.emotion.summary, sample.emotion.summary);
assert.deepEqual(
  parsed.replies.map((item) => item.style),
  ['得体', '幽默', '高冷'],
);
assert.equal(parsed.meme.name, '猫猫探头');

const noisy = `说明文字\n${JSON.stringify(sample)}\n后面还有废话`;
assert.equal(parseAnalysisContent(noisy).replies.length, 3);

assert.deepEqual(normalizeConversationAnalysis('对方在找台阶'), {
  summary: '对方在找台阶',
  subtext: '',
  dynamic: '',
  advice: '',
});
assert.throws(
  () => normalizeConversationAnalysis({ summary: '', subtext: '', dynamic: '', advice: '' }),
  /Empty conversation analysis/,
);

assert.deepEqual(normalizeEmotion('气氛有点怪'), {
  other: '',
  me: '',
  summary: '气氛有点怪',
});

assert.throws(
  () => normalizeEmotion({ other: '', me: '', summary: '' }),
  /Empty emotion/,
  'empty emotion should throw',
);

assert.deepEqual(
  normalizeReplies([
    { style: '随便', text: '第一条' },
    { style: '随便', text: '第二条' },
    { style: '随便', text: '第三条' },
  ]).map((item) => item.style),
  ['得体', '幽默', '高冷'],
);
assert.throws(() => normalizeReplies(['只有一条']), /Missing replies/);

assert.deepEqual(normalizeMeme({ name: '', description: '', usage: '' }), {
  name: '猫猫探头',
  description: '一张猫猫从屏幕边缘探头的表情包。',
  usage: '适合用来软化气氛，或者重新开启话题。',
});

assert.deepEqual(normalizeTopics({ topics: ['话题一', '话题二', '话题三'] }), {
  topics: ['话题一', '话题二'],
});
assert.deepEqual(parseTopicsContent('{"topics":["周末去哪玩","最近追什么剧"]}'), {
  topics: ['周末去哪玩', '最近追什么剧'],
});
assert.throws(() => normalizeTopics({ topics: ['只有一个'] }), /Missing topics/);

const sassyPrompt = buildAnalysisSystemPrompt('sassy');
assert.ok(sassyPrompt.includes('阴阳怪气'));
assert.ok(sassyPrompt.includes('jargon_analysis'));
assert.ok(sassyPrompt.includes('conversation_analysis'));
assert.ok(sassyPrompt.includes('"meme"'));

assert.equal(isConcurrencyError(429, null, ''), true);
assert.equal(isConcurrencyError(400, { error: { code: '1302' } }, ''), true);
assert.equal(isConcurrencyError(500, null, 'rate limit reached'), true);
assert.equal(
  isConcurrencyError(
    200,
    { choices: [{ message: { content: '{"emotion":"流量不够"}' } }] },
    '{"choices":[{"message":{"content":"流量不够"}}]}',
  ),
  false,
  'successful model text mentioning 流量 must not be treated as a 429',
);

console.log('server internals: all assertions passed');
