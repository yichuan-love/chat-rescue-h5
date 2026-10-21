'use strict';

require('dotenv').config();

const { _internals } = require('../server');

const key = _internals.normalizeApiKey(process.env.ZHIPU_API_KEY);
const endpoint =
  process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const model = (process.env.ZHIPU_MODEL || 'glm-4v-flash').trim();

const IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

(async () => {
  if (!key) {
    console.error('未读取到 ZHIPU_API_KEY，请先检查 .env。');
    process.exitCode = 1;
    return;
  }

  console.log('Key 已读取（不显示内容）：');
  console.log(
    JSON.stringify({
      length: key.length,
      hasDot: key.includes('.'),
      hasWhitespace: /\s/.test(key),
      looksLikeExample: key === 'your_api_key_here',
    }),
  );

  let auth;
  try {
    auth = _internals.buildZhipuAuthorization(key);
  } catch (error) {
    console.error('鉴权参数错误：', error.message);
    console.error('JWT 模式需要 id.secret 格式的 Key。');
    process.exitCode = 1;
    return;
  }

  console.log('鉴权模式:', auth.mode);
  console.log('Endpoint:', endpoint);
  console.log('Model:', model);
  console.log('');

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: IMAGE } },
              { type: 'text', text: '只回复 OK' },
            ],
          },
        ],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    console.error('请求失败：', error.name, error.message);
    process.exitCode = 1;
    return;
  }

  const text = await response.text();
  const requestId =
    response.headers.get('x-request-id') || response.headers.get('request-id') || '';

  console.log('HTTP 状态码:', response.status);
  if (requestId) console.log('Request ID:', requestId);
  console.log('响应:', text.slice(0, 800));

  if (response.ok) {
    console.log('\nKey 可用，智谱接口调用成功。');
    return;
  }

  if (response.status === 401) {
    console.error(
      auth.mode === 'jwt'
        ? '\nJWT 鉴权失败：Key/secret 不正确、已过期，或不是可用的 id.secret Key。'
        : '\n原始 Key 被智谱拒绝：Key 无效、已过期，或不是“标准 API Key”。',
    );
    console.error('请按下面顺序检查：');
    console.error('1. 打开 https://bigmodel.cn/usercenter/proj-mgmt/apikeys');
    console.error('2. 确认使用的是“标准 API Key”，不要用个人/团队 Coding Plan 套餐 Key');
    console.error('3. 如果 Key 是 id.secret 形式，确认点号前后完整，且没有被重置');
    console.error('4. 确认账号有可用余额/资源包，且 Key 未被删除');
    console.error('5. 把新 Key 写入 .env 的 ZHIPU_API_KEY，然后重启 node server.js');
  } else if (response.status === 403) {
    console.error('\nKey 没有调用该模型的权限，请检查 Key 类型和模型权限。');
  } else if (response.status === 429) {
    console.error('\n请求被限流或并发受限，请稍后重试。');
  }

  process.exitCode = 1;
})();
