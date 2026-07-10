# scgk114 内部测试清单

目标：让 1-2 位朋友通过内部 Key 使用你的上游 OpenAI API 流量，同时不暴露你的真实 OpenAI API Key。

## 你需要准备

1. 一个 OpenAI API Key 或 Project Key。
2. 一个能部署 Node 后端的平台账号，推荐 Render。
3. 一个后端域名，建议 `api.scgk114.com`。
4. 1-2 位测试成员的姓名或备注。

## 本机验证

```bash
npm install
npm run build
npm run serve:mvp
```

另开终端：

```bash
npm run test:mvp
```

默认测试地址：

```text
http://127.0.0.1:8787/v1
```

默认内部测试 Key：

```text
sk-scgk114-test-local
```

## 真实上游模式

PowerShell：

```powershell
$env:OPENAI_API_KEY="你的 OpenAI API Key"
npm run serve:mvp
```

朋友拿到的是内部 Key，例如：

```text
sk-scgk114-xxxx
```

你的真实 `OPENAI_API_KEY` 只保存在服务器环境变量里。

## Render 部署

1. 把本项目推到 GitHub。
2. 进入 Render Dashboard，选择 Blueprint 或 New Web Service。
3. 如果使用 Blueprint，Render 会读取 `render.yaml`。
4. 设置环境变量：

```text
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_BASE_URL=https://api.openai.com/v1
HOST=0.0.0.0
```

不要手动设置 `PORT`，Render 会自动注入。

## 朋友测试配置

Base URL：

```text
https://api.scgk114.com/v1
```

API Key：

```text
sk-scgk114-内部Key
```

## 判断是否通过

- `GET /api/health` 显示 `upstreamConnected: true`。
- Codex 能收到模型响应。
- 后台 `/api/admin/summary` 能看到请求记录。
- 你的真实 OpenAI API Key 没有发给测试成员。
