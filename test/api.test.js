'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');

const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const ANALYSIS = {
  jargon_analysis: [
    { term: 'emmm', plain: '在犹豫，不知道怎么接。', context: '对方正在拖时间。' },
  ],
  conversation_analysis: {
    summary: '对方在找理由结束话题',
    subtext: '不是没空，是不太想继续',
    dynamic: '你现在偏被动',
    advice: '给个台阶，先收一下',
  },
  emotion: {
    other: '对方有点敷衍',
    me: '你现在偏被动',
    summary: '气氛偏冷，先别再追问',
  },
  replies: [
    { style: '得体', text: '那你先忙，忙完再说。' },
    { style: '幽默', text: '收到，我先去表情包库补货。' },
    { style: '高冷', text: '行，等你有空再聊。' },
  ],
  meme: {
    name: '猫猫探头',
    description: '猫猫从屏幕边缘探出来。',
    usage: '冷场时发一下，配“在吗”。',
  },
};

const TOPICS = {
  topics: ['周末一般怎么放松？', '最近有没有追什么剧？'],
};

let mockMode = 'analysis';
let mockDelay = 0;
let lastAuthorization = '';
let lastRequest = null;

function sendJson(res, status, body) {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendModelResult(res) {
  const result = mockMode === 'topics' ? TOPICS : ANALYSIS;
  sendJson(res, 200, {
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

const mock = http.createServer((req, res) => {
  lastAuthorization = req.headers.authorization || '';
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    try {
      lastRequest = JSON.parse(body);
    } catch {
      lastRequest = null;
    }

    if (lastRequest && Number(lastRequest.max_tokens) > 1024) {
      sendJson(res, 400, {
        error: {
          code: '1210',
          message: 'max_tokens参数非法：限制数值范围 [1,1024]',
        },
      });
      return;
    }

    if (mockMode === '429') {
      sendJson(res, 429, {
        error: { code: '1302', message: '您的并发量达到上限，请稍后再试' },
      });
      return;
    }
    if (mockMode === 'slow') {
      setTimeout(() => sendModelResult(res), mockDelay);
      return;
    }
    sendModelResult(res);
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.listen(0, '127.0.0.1', resolve);
  });

  const mockPort = mock.address().port;
  process.env.ZHIPU_API_KEY = 'test-id.test-secret';
  process.env.ZHIPU_AUTH_MODE = 'jwt';
  process.env.ZHIPU_API_URL = `http://127.0.0.1:${mockPort}/v1/chat/completions`;
  process.env.ZHIPU_TIMEOUT_MS = '1500';
  process.env.RATE_LIMIT_MAX = '7';
  process.env.RATE_LIMIT_WINDOW_MS = '60000';

  const app = require('../server');
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function callApi(pathname, payload) {
    const startedAt = Date.now();
    const response = await fetch(`${base}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      body: await response.json(),
      elapsed: Date.now() - startedAt,
    };
  }

  // 1. 多模态分析：图片 + 文字 + 阴阳怪气人设
  mockMode = 'analysis';
  const ok = await callApi('/api/analyze', {
    image: IMAGE,
    text: '他说在忙，但又发了 emmm。',
    persona: 'sassy',
    action: 'analyze',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.jargon_analysis[0].term, 'emmm');
  assert.equal(ok.body.conversation_analysis.summary, '对方在找理由结束话题');
  assert.equal(ok.body.replies.length, 3);
  assert.deepEqual(
    ok.body.replies.map((item) => item.style),
    ['得体', '幽默', '高冷'],
  );
  assert.equal(ok.body.meme.name, '猫猫探头');
  assert.ok(ok.body.emotion.other);

  assert.ok(lastAuthorization.startsWith('Bearer eyJ'), 'request should use JWT');
  const jwtParts = lastAuthorization.slice('Bearer '.length).split('.');
  assert.equal(jwtParts.length, 3);
  const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString('utf8'));
  assert.equal(jwtPayload.api_key, 'test-id');
  assert.ok(jwtPayload.exp > jwtPayload.timestamp);

  assert.equal(lastRequest.model, 'glm-4v-flash');
  assert.ok(lastRequest.max_tokens <= 1024, 'max_tokens must fit glm-4v-flash');
  assert.ok(lastRequest.messages[0].content.includes('阴阳怪气'));
  assert.ok(Array.isArray(lastRequest.messages[1].content));
  assert.equal(lastRequest.messages[1].content[0].type, 'image_url');
  assert.ok(lastRequest.messages[1].content[1].text.includes('他说在忙'));

  // 2. 换一批：保留上下文，带上一批回复，要求不重复
  const refreshed = await callApi('/api/analyze', {
    image: IMAGE,
    text: '他说在忙，但又发了 emmm。',
    persona: 'sassy',
    action: 'more_replies',
    previous_replies: ok.body.replies.map((item) => item.text),
  });
  assert.equal(refreshed.status, 200);
  assert.ok(lastRequest.messages[1].content[1].text.includes('换一批'));
  assert.ok(lastRequest.messages[1].content[1].text.includes('禁止重复'));

  // 3. 接下来聊什么
  mockMode = 'topics';
  const topics = await callApi('/api/topics', {
    image: IMAGE,
    text: '他说在忙，但又发了 emmm。',
    persona: 'sassy',
    previous_replies: ok.body.replies.map((item) => item.text),
  });
  assert.equal(topics.status, 200);
  assert.equal(topics.body.topics.length, 2);
  assert.ok(lastRequest.messages[0].content.includes('聊天续场'));

  // 4. 上游 429
  mockMode = '429';
  const limited = await callApi('/api/analyze', {
    text: '测试限流',
    persona: 'polite',
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, '当前人太多了，请等3秒再试~');

  // 5. 上游超时
  mockMode = 'slow';
  mockDelay = 1800;
  const timedOut = await callApi('/api/analyze', {
    text: '测试超时',
    persona: 'polite',
  });
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.error, 'AI卡壳了，请稍后再试');
  assert.ok(timedOut.elapsed >= 1300, `timeout too fast: ${timedOut.elapsed}ms`);

  // 6. 本地单并发闸门
  mockMode = 'slow';
  mockDelay = 500;
  const first = callApi('/api/analyze', { text: '并发的第一条', persona: 'polite' });
  await sleep(60);
  const second = await callApi('/api/analyze', { text: '并发的第二条', persona: 'polite' });
  const firstResult = await first;
  assert.equal(second.status, 429);
  assert.equal(second.body.error, '当前人太多了，请等3秒再试~');
  assert.equal(firstResult.status, 200);

  // 7. 限流（测试环境把上限调到 7，第 8 次应被拦）
  mockMode = 'analysis';
  const rateLimited = await callApi('/api/analyze', {
    text: '测试限流上限',
    persona: 'polite',
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error, '手速太快啦，歇 1 分钟再试~');

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const manifestResponse = await fetch(`${base}/manifest.json`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);

  const swResponse = await fetch(`${base}/sw.js`);
  assert.equal(swResponse.status, 200);
  assert.equal(swResponse.headers.get('service-worker-allowed'), '/');
  const swText = await swResponse.text();
  assert.ok(swText.includes("url.pathname.startsWith('/api/')"));

  const iconResponse = await fetch(`${base}/icons/icon-192.png`);
  assert.equal(iconResponse.status, 200);

  const rootResponse = await fetch(`${base}/`);
  assert.equal(rootResponse.status, 200);
  assert.ok(String(rootResponse.headers.get('content-security-policy')).includes("worker-src 'self'"));
  const rootHtml = await rootResponse.text();
  assert.ok(rootHtml.includes('rel="manifest"'));

  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => mock.close(resolve));
  console.log(
    'api flow: multimodal / refresh / topics / 429 / timeout / concurrency / rate-limit / pwa passed',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
