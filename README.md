# scgk114 API 中转站 MVP

这是给 `www.scgk114.com` 准备的前端样板，用来演示课题组 OpenAI / Codex 订阅额度池的完整使用流程。

## 当前页面

- 订阅额度总览：总额度、已用额度、使用率、请求数、七日趋势、最近请求。
- 额度池与分组：上游 Pro / Plus 订阅池、分组倍率、访问范围、池子状态。
- 成员与登录码：成员 Key、个人月度额度、并发、暂停/重置样板、一次性登录码状态。
- 成员激活：输入登录码和姓名，生成演示 API Key，并同步更新成员与登录码状态。
- Codex 接入：`https://api.scgk114.com/v1`、`config.toml`、`auth.json` 示例和上线清单。
- 状态监控：上游池可用性、延迟、PING、异常计数。

## 今日内测可用交互

- 管理员可在“成员”页生成一次性登录码。
- 激活页可用未使用登录码生成演示 Key。
- 接入页可复制 Base URL、Codex 配置和 `auth.json` 样板。
- 总览页会显示订阅总池、使用率、请求记录和最近元数据。
- 真实接入上游 Pro 账号前，页面只做流程演示，不会调用真实模型。

## 本机 API mock 后端

先打包前端：

```bash
npm run build
```

启动本地 OpenAI-compatible mock 后端：

```bash
npm run serve:mvp
```

另开一个终端自测：

```bash
npm run test:mvp
```

默认地址：

```text
http://127.0.0.1:8787/v1
```

默认测试 Key：

```text
sk-scgk114-test-local
```

可测试接口：

- `GET /api/health`
- `POST /api/invites`
- `POST /api/activate`
- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`

此后端默认返回 mock 响应并记录用量，不会连接真实 OpenAI / Pro 上游账号。等进入真实调用测试时，再接入上游订阅池。

## 真实上游内测模式

如果今天要让朋友通过内部 Key 使用你账户名下的 OpenAI API 流量，启动前设置环境变量：

```powershell
$env:OPENAI_API_KEY="你的 OpenAI API Key"
npm run serve:mvp
```

设置后：

- 朋友仍然只拿 `sk-scgk114-...` 内部 Key。
- 你的真实 `OPENAI_API_KEY` 只保存在服务器环境变量里，不发给朋友。
- `/v1/responses`、`/v1/chat/completions`、`/v1/models` 会转发到官方 OpenAI API。
- 后端会继续记录内部 Key、模型、Token、使用率和请求状态。

可选环境变量：

```powershell
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:HOST="127.0.0.1"
$env:PORT="8787"
```

注意：这走的是 OpenAI API Key 对应账户的 API 流量/账单，不是把 ChatGPT Pro 网页订阅额度官方转换成 API。若要给朋友在外部电脑使用，需要把本服务部署到公网服务器，并使用 HTTPS 域名作为 Base URL。

## Render 部署准备

项目已包含：

- `render.yaml`：Render Blueprint 配置。
- `.env.example`：本地环境变量示例。
- `INTERNAL_TEST.md`：1-2 人真实内测步骤。

推荐流程：

1. 把本项目推到 GitHub。
2. 在 Render 创建 Web Service 或 Blueprint。
3. 设置 `OPENAI_API_KEY` 环境变量。
4. 绑定 `api.scgk114.com`。
5. 让朋友使用 `https://api.scgk114.com/v1` 和内部 Key 测试。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

## 打包

```bash
npm run build
```

生成的静态站点在 `dist/` 目录，可部署到任意静态网站服务。

## 说明

当前数据是演示数据。真实上线时还需要接入后端接口，用于登录码激活、成员 Key 校验、OpenAI API 转发、请求日志、Token 统计、额度池调度和异常暂停。
