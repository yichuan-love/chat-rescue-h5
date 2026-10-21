# 聊天救场 · 朋友圈内测版

一个给朋友小范围测试的 H5「聊天救场」工具：截图、文字、语音都能分析，读懂潜台词，给出 3 条高情商回复。

## 功能

- **多模态输入**：上传聊天截图、全局 `Ctrl / ⌘ + V` 粘贴图片、纯文字输入、Web Speech API 语音转文字。
- **3 种人设**：高情商得体 / 幽默搞笑 / 阴阳怪气，提交前切换，后端 Prompt 动态调整。
- **结构化结果**：对话分析、黑话/术语解析、对方情绪与我方处境、3 条不同风格回复、配套表情包推荐。
- **结果操作**：每条回复一键复制；「🔄 换一批话术」保留上下文重新生成；「💡 接下来聊什么？」生成 2 个延伸话题。
- **PWA**：`manifest.json` + Service Worker + 图标，可添加到手机主屏幕，`display: standalone` 无浏览器地址栏。
- **阅后即焚**：不使用 LocalStorage / SessionStorage，刷新页面即清空输入和结果；截图只在内存中转发，不落盘。
- **轻量保护**：单 IP 每分钟 5 次、上游 8 秒超时、单并发闸门、429 / 401 友好提示。

## 文件结构

```text
.
├── package.json          # 依赖与脚本
├── server.js             # Express + 智谱调用 + Prompt + 限流/超时/并发 + PWA 静态路由
├── index.html            # 单文件前端（无外部 CSS/JS）
├── manifest.json         # PWA 配置
├── sw.js                 # Service Worker，只缓存静态壳，不缓存 /api
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── .env.example
├── api/
│   ├── analyze.js        # Vercel Function: /api/analyze
│   ├── topics.js         # Vercel Function: /api/topics
│   └── healthz.js        # Vercel Function: /api/healthz
├── scripts/check-key.js  # 独立验证 API Key / JWT
├── vercel.json
├── test/
│   ├── internals.test.js # 解析器 + JWT + Prompt 静态检查
│   ├── html-audit.js     # HTML / PWA / 隐私检查
│   └── api.test.js       # 多模态、换一批、话题、429、超时、并发、限流
└── README.md
```

## 本地运行

要求 Node.js 18.17+。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
# 然后编辑 .env，填入 ZHIPU_API_KEY

# 3. 启动
npm start
```

打开 <http://localhost:3000>。

```bash
# 可选：验证 Key 是否可用、当前走 raw 还是 jwt
npm run check:key

# 可选：跑测试与语法检查
npm test
npm run check
```

> 新增的语音、PWA、复制等功能都使用浏览器原生 API，**没有增加 npm 依赖**。已有项目目录不需要重新 `npm install`；全新拉取代码或删过 `node_modules` 时需要。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 是 | 智谱 API Key |
| `ZHIPU_MODEL` | 否 | 图片分析模型，默认 `glm-4v-flash` |
| `ZHIPU_TEXT_MODEL` | 否 | 纯文字分析模型，不填则沿用 `ZHIPU_MODEL` |
| `ZHIPU_AUTH_MODE` | 否 | `auto`（默认）/ `jwt` / `raw` |
| `ZHIPU_JWT_TTL_SECONDS` | 否 | JWT 有效期，默认 3600 秒 |
| `ZHIPU_TIMEOUT_MS` | 否 | 上游超时，默认 8000 毫秒 |
| `PORT` | 否 | 本地端口；Vercel / Render 自动注入 |
| `RATE_LIMIT_MAX` | 否 | 限流次数，默认 5 次/分钟 |
| `RATE_LIMIT_WINDOW_MS` | 否 | 限流窗口，默认 60000 毫秒 |
| `TRUST_PROXY` | 否 | 反代层数；Vercel / Render 会自动按 1 层处理 |

### API Key 注意事项

2026-10-16 起，标准 API Key、个人 Coding Plan Key、团队 Coding Plan Key 互不通用。本项目使用标准 `open.bigmodel.cn/api/paas/v4` 端点，建议使用[标准 API Key](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)。

`ZHIPU_AUTH_MODE=auto` 的规则：

- Key 包含点号（`id.secret`）：用 `secret` 生成 HMAC-SHA256 JWT；
- Key 不含点号：直接使用原始 Key。

JWT Payload：

```json
{
  "api_key": "点号前半段",
  "exp": "当前毫秒时间戳 + TTL",
  "timestamp": "当前毫秒时间戳"
}
```

JWT Header：`{"alg":"HS256","typ":"JWT","sign_type":"SIGN"}`。如果只有 32 位无点号 Key，就无法生成 JWT；这种情况通常会走原始 Key 鉴权。详见[智谱 HTTP API 文档](https://docs.bigmodel.cn/cn/guide/develop/http/introduction)。

## API

### `POST /api/analyze`

请求：

```json
{
  "image": "data:image/jpeg;base64,...",
  "text": "他说在忙，但又发了 emmm。",
  "persona": "polite",
  "action": "analyze",
  "previous_replies": []
}
```

- `image` 和 `text` 至少传一个，可以同时传。
- `persona`：`polite` / `funny` / `sassy`。
- `action`：`analyze`（默认）或 `more_replies`（换一批）。
- `previous_replies`：换一批时传上一批回复，避免重复。

成功响应：

```json
{
  "jargon_analysis": [
    {
      "term": "emmm",
      "plain": "在犹豫，一时不知道怎么接。",
      "context": "对方在拖时间。"
    }
  ],
  "conversation_analysis": {
    "summary": "对方在找理由结束话题",
    "subtext": "不是没空，是不太想继续",
    "dynamic": "你现在偏被动",
    "advice": "给个台阶，先收一下"
  },
  "emotion": {
    "other": "对方有点敷衍",
    "me": "你现在偏被动",
    "summary": "气氛偏冷，先别再追问"
  },
  "replies": [
    { "style": "得体", "text": "那你先忙，忙完再说。" },
    { "style": "幽默", "text": "懂了，你的表情包库需要补货。" },
    { "style": "高冷", "text": "行，等你有空再聊。" }
  ],
  "meme": {
    "name": "猫猫探头",
    "description": "猫猫从屏幕边缘探出来。",
    "usage": "冷场时发一下，配“在吗”。"
  }
}
```

### `POST /api/topics`

请求字段与 `/api/analyze` 相同，`persona` 可选；返回：

```json
{
  "topics": ["周末一般怎么放松？", "最近有没有追什么剧？"]
}
```

### `GET /healthz`

健康检查：`{ "ok": true }`。Vercel 对应路径为 `/api/healthz`。

所有错误统一为：

```json
{ "error": "当前人太多了，请等3秒再试~" }
```

## 保护与隐私

- **限流**：同一 IP 默认每分钟 5 次，`express-rate-limit` 内存存储。
- **超时**：上游请求默认 8 秒，超时返回 `AI卡壳了，请稍后再试`。
- **输出长度**：`max_tokens` 上限固定为 1024，兼容 `glm-4v-flash` 的 `[1,1024]` 限制。
- **并发兜底**：进程内单并发闸门；上游 429 / 错误码 `1302` 转成友好 JSON。
- **图片**：前端 Canvas 压缩，宽度 ≤ 800px，目标小于 1.8MB；服务端只接受 JPG / PNG / WebP data URL。
- **不落盘**：不写数据库、不写文件、不记录截图或文字；Service Worker 不缓存 `/api/`。
- **无本地存储**：前端不使用 LocalStorage / SessionStorage，刷新即清空。
- **Prompt 安全**：截图和文字都作为待分析素材，Prompt 明确忽略其中的指令注入；后端校验 JSON 结构，非法输出不透传。

> 朋友小范围测试用，限流和并发锁是单实例内存级保护，不是商业级风控。Vercel 多实例之间不共享计数。

## PWA 安装

- **iOS Safari**：打开网页 → 分享 → 添加到主屏幕。
- **Android Chrome**：浏览器菜单 → 添加到主屏幕 / 安装应用。
- 配置了 `display: standalone`，从主屏幕启动时不会显示浏览器地址栏。

Service Worker 只缓存 `index.html`、manifest 和图标；分析接口与用户输入不会进入缓存。更新静态文件后若手机仍显示旧版，可关闭 PWA 再打开，或在浏览器设置中清除站点数据。

## 部署到 Vercel 免费版

1. 把项目推到 GitHub，确认 `.env` 没被提交。
2. Vercel → `Add New...` → `Project`，导入仓库。
3. 配置：
   - Framework Preset：`Other`
   - Root Directory：项目根目录
   - Build Command：留空
   - Output Directory：留空
4. 环境变量添加 `ZHIPU_API_KEY`，可选 `ZHIPU_MODEL` / `ZHIPU_AUTH_MODE`。
5. 点击 `Deploy`。

Vercel 会静态托管 `index.html`、`manifest.json`、`sw.js`、`icons/`，并把 `api/analyze.js`、`api/topics.js`、`api/healthz.js` 识别为 Serverless Functions。`vercel.json` 已把函数最大执行时间设为 10 秒，并补上 PWA 所需的 CSP、`worker-src`、`manifest-src` 和 `sw.js` 缓存头。

> `PORT` 不需要在 Vercel / Render 中配置，平台会自动注入。

## 部署到 Render 免费版

1. Render → `New` → `Web Service`，连接 GitHub 仓库。
2. 填写：
   - Runtime：`Node`
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Instance Type：`Free`
3. 环境变量添加 `ZHIPU_API_KEY`，可选 `ZHIPU_MODEL` / `ZHIPU_AUTH_MODE`。
4. 创建后打开 `onrender.com` 链接。

Render 免费实例会休眠，首次打开可能需要等待 30～60 秒；前端已做 60 秒等待提示。PWA 的 Service Worker 需要 HTTPS，Render / Vercel 默认都满足。

## 常见问题

### 提示「API Key / JWT 鉴权失败」

先运行：

```bash
npm run check:key
```

它会显示当前 `ZHIPU_AUTH_MODE` 实际走的是 `raw` 还是 `jwt`、HTTP 状态和 Request ID，不会显示 Key 内容。

- `raw` + 401：Key 无效/过期，或不是标准 API Key；
- `jwt` + 401：`id.secret` 的 secret 不正确，或 Key 已失效；
- 32 位无点号 Key 无法生成 JWT，只能走原始 Key；
- 确认账号有可用余额/资源包，且没有使用 Coding Plan 套餐 Key。

### 提示「当前人太多了，请等3秒再试~」

同时有人在用，或上游免费模型并发达到上限。等 3 秒再点。

### 提示「手速太快啦，歇 1 分钟再试~」

触发了单 IP 限流。等 1 分钟，或换网络。

### 语音按钮没反应

Web Speech API 需要浏览器支持且页面运行在 HTTPS（localhost 除外）。微信内置浏览器不一定支持，此时按钮会给出提示，直接用键盘输入即可。

### PWA 添加不了 / 仍有地址栏

- 需要 HTTPS（Vercel / Render 默认满足）；
- iOS 用 Safari 的“添加到主屏幕”；
- Android 用 Chrome 的“安装应用 / 添加到主屏幕”；
- 如果之前装过旧版，先删除旧图标再重新添加。

### Vercel 报 `FUNCTION_INVOCATION_TIMEOUT`

后端上游超时为 8 秒，Vercel 函数上限 10 秒，正常应返回 JSON。若持续超时，检查 Key 是否有效、智谱接口是否变慢，或临时调低 `ZHIPU_TIMEOUT_MS`。

## 免责声明

仅供娱乐，请勿上传包含真实姓名、电话等敏感信息的截图。
