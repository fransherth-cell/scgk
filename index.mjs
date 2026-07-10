import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync, createReadStream } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const upstreamApiKey = process.env.OPENAI_API_KEY || ''
const upstreamBaseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
const upstreamMode = upstreamApiKey ? 'real' : 'mock'
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const distDir = join(rootDir, 'dist')
const dataDir = join(rootDir, 'server', 'data')
const statePath = join(dataDir, 'state.json')

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

const defaultState = {
  invites: [
    {
      code: 'SCGK-N9P3',
      createdAt: '07-09',
      group: 'GPT1',
      owner: '今日内测名额',
      status: 'unused',
      usedAt: '-',
    },
  ],
  keys: [
    {
      createdAt: new Date().toISOString(),
      group: 'GPT1',
      key: 'sk-scgk114-test-local',
      label: '本机测试 Key',
      name: '本机管理员',
      quotaLimit: 3,
      quotaUsed: 0,
      requestCount: 0,
      status: 'active',
    },
  ],
  requests: [],
  pools: [
    {
      name: 'OpenAI Pro 主池',
      plan: 'Pro 20x',
      capacity: 20,
      used: 0,
      status: 'mock',
    },
  ],
}

await ensureState()

const server = createServer(async (req, res) => {
  try {
    setCors(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    if (url.pathname.startsWith('/api/')) {
      await handleAdminApi(req, res, url)
      return
    }

    if (url.pathname.startsWith('/v1/')) {
      await handleOpenAiCompat(req, res, url)
      return
    }

    await serveStatic(res, url.pathname)
  } catch (error) {
    sendJson(res, 500, {
      error: {
        message: error instanceof Error ? error.message : 'Unknown server error',
        type: 'server_error',
      },
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`scgk114 MVP server running at http://${HOST}:${PORT}`)
  console.log(`OpenAI-compatible base URL: http://${HOST}:${PORT}/v1`)
  console.log(`Upstream mode: ${upstreamMode}`)
  console.log('Default test key: sk-scgk114-test-local')
})

async function handleAdminApi(req, res, url) {
  const state = await readState()

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      mode: upstreamMode,
      upstreamBaseUrl,
      upstreamConnected: Boolean(upstreamApiKey),
      baseUrl: `http://${HOST}:${PORT}/v1`,
      needsAccount: upstreamApiKey
        ? '已配置 OPENAI_API_KEY，朋友可使用内部 Key 走你的上游 API 账户'
        : '要让朋友使用你的账户流量，请在服务器环境变量中配置 OPENAI_API_KEY',
      pools: state.pools,
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/summary') {
    sendJson(res, 200, summarizeState(state))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/invites') {
    const body = await readJson(req)
    const invite = {
      code: createInviteCode(state.invites),
      createdAt: formatDay(new Date()),
      group: body.group || 'GPT1',
      owner: body.owner || '今日内测名额',
      status: 'unused',
      usedAt: '-',
    }

    state.invites.unshift(invite)
    await writeState(state)
    sendJson(res, 201, invite)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/activate') {
    const body = await readJson(req)
    const code = String(body.code || '').trim()
    const invite = state.invites.find((item) => item.code === code)

    if (!invite) {
      sendJson(res, 404, { error: '登录码不存在' })
      return
    }

    if (invite.status !== 'unused') {
      sendJson(res, 409, { error: '登录码已经使用或停用' })
      return
    }

    const key = createInternalKey()
    const name = String(body.name || '今日内测成员').trim()

    invite.status = 'used'
    invite.owner = name
    invite.group = body.group || invite.group
    invite.usedAt = '刚刚'

    state.keys.unshift({
      createdAt: new Date().toISOString(),
      group: invite.group,
      key,
      label: maskKey(key),
      name,
      quotaLimit: 3,
      quotaUsed: 0,
      requestCount: 0,
      status: 'active',
    })

    await writeState(state)
    sendJson(res, 201, {
      baseUrl: `http://${HOST}:${PORT}/v1`,
      group: invite.group,
      key,
      name,
    })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

async function handleOpenAiCompat(req, res, url) {
  const state = await readState()
  const auth = String(req.headers.authorization || '')
  const apiKey = auth.replace(/^Bearer\s+/i, '').trim()
  const keyRecord = state.keys.find(
    (item) => item.key === apiKey && item.status === 'active',
  )

  if (!keyRecord) {
    sendJson(res, 401, {
      error: {
        message: 'Invalid or missing internal API key',
        type: 'invalid_request_error',
      },
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    if (upstreamApiKey) {
      await proxyUpstream({
        body: null,
        keyRecord,
        method: 'GET',
        req,
        res,
        state,
        url,
      })
      return
    }

    sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'gpt-5.5', object: 'model', owned_by: 'scgk114-mock' },
        { id: 'gpt-5.5-mini', object: 'model', owned_by: 'scgk114-mock' },
      ],
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = await readJson(req)

    if (upstreamApiKey) {
      await proxyUpstream({
        body,
        keyRecord,
        method: 'POST',
        req,
        res,
        state,
        url,
      })
      return
    }

    const text = makeMockText(body)
    const usage = estimateUsage(body, text)
    await recordUsage(state, keyRecord, {
      endpoint: '/v1/chat/completions',
      model: body.model || 'gpt-5.5',
      status: 'mock_success',
      usage,
    })

    if (body.stream) {
      sendChatStream(res, text)
      return
    }

    sendJson(res, 200, {
      id: `chatcmpl_${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'gpt-5.5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
          },
          finish_reason: 'stop',
        },
      ],
      usage,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/responses') {
    const body = await readJson(req)

    if (upstreamApiKey) {
      await proxyUpstream({
        body,
        keyRecord,
        method: 'POST',
        req,
        res,
        state,
        url,
      })
      return
    }

    const text = makeMockText(body)
    const usage = estimateUsage(body, text)
    const response = makeResponseObject(body, text, usage)
    await recordUsage(state, keyRecord, {
      endpoint: '/v1/responses',
      model: body.model || 'gpt-5.5',
      status: 'mock_success',
      usage,
    })

    if (body.stream) {
      sendResponseStream(res, response, text)
      return
    }

    sendJson(res, 200, response)
    return
  }

  sendJson(res, 404, {
    error: {
      message: 'Endpoint not implemented in MVP mock server',
      type: 'not_found',
    },
  })
}

async function proxyUpstream({ body, keyRecord, method, res, state, url }) {
  const upstreamPath = url.pathname.replace(/^\/v1/, '')
  const upstreamUrl = `${upstreamBaseUrl}${upstreamPath}${url.search}`
  const headers = {
    Authorization: `Bearer ${upstreamApiKey}`,
    'Content-Type': 'application/json',
  }
  const upstreamRes = await fetch(upstreamUrl, {
    body: body ? JSON.stringify(body) : undefined,
    headers,
    method,
  })
  const contentType = upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8'

  if (body?.stream && upstreamRes.body) {
    await recordUsage(state, keyRecord, {
      endpoint: url.pathname,
      model: body.model || 'upstream',
      status: upstreamRes.ok ? 'upstream_stream' : 'upstream_error',
      usage: estimateUsage(body, ''),
    })
    res.writeHead(upstreamRes.status, {
      'Cache-Control': upstreamRes.headers.get('cache-control') || 'no-cache',
      'Connection': 'keep-alive',
      'Content-Type': contentType,
    })
    Readable.fromWeb(upstreamRes.body).pipe(res)
    return
  }

  const text = await upstreamRes.text()
  const parsed = parseMaybeJson(text)

  await recordUsage(state, keyRecord, {
    endpoint: url.pathname,
    model: body?.model || parsed?.model || 'upstream',
    status: upstreamRes.ok ? 'upstream_success' : 'upstream_error',
    usage: extractUsage(parsed, body),
  })

  res.writeHead(upstreamRes.status, {
    'Content-Type': contentType,
  })
  res.end(text)
}

async function ensureState() {
  await mkdir(dataDir, { recursive: true })

  if (!existsSync(statePath)) {
    await writeFile(statePath, JSON.stringify(defaultState, null, 2), 'utf8')
  }
}

async function readState() {
  return JSON.parse(await readFile(statePath, 'utf8'))
}

async function writeState(state) {
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')
}

async function readJson(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

async function recordUsage(state, keyRecord, entry) {
  const quota = Number(((entry.usage.total_tokens || 0) / 100_000).toFixed(3))
  keyRecord.quotaUsed = Number((Number(keyRecord.quotaUsed || 0) + quota).toFixed(3))
  keyRecord.requestCount = Number(keyRecord.requestCount || 0) + 1
  state.pools[0].used = Number((Number(state.pools[0].used || 0) + quota).toFixed(3))
  state.requests.unshift({
    at: new Date().toISOString(),
    endpoint: entry.endpoint,
    key: maskKey(keyRecord.key),
    model: entry.model,
    name: keyRecord.name,
    quota,
    status: entry.status,
    tokens: entry.usage.total_tokens,
  })
  state.requests = state.requests.slice(0, 100)
  await writeState(state)
}

function summarizeState(state) {
  const totalCapacity = state.pools.reduce((sum, pool) => sum + Number(pool.capacity || 0), 0)
  const used = state.pools.reduce((sum, pool) => sum + Number(pool.used || 0), 0)

  return {
    invites: state.invites,
    keys: state.keys.map((key) => ({
      ...key,
      key: maskKey(key.key),
    })),
    pools: state.pools,
    recentRequests: state.requests.slice(0, 20),
    totals: {
      totalCapacity,
      used,
      remaining: Math.max(totalCapacity - used, 0),
      usagePercent: totalCapacity ? Math.round((used / totalCapacity) * 100) : 0,
    },
  }
}

async function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname
  const filePath = resolve(join(distDir, safePath))

  if (!filePath.startsWith(distDir)) {
    sendText(res, 403, 'Forbidden')
    return
  }

  try {
    const fileStat = await stat(filePath)

    if (fileStat.isFile()) {
      res.writeHead(200, {
        'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      })
      createReadStream(filePath).pipe(res)
      return
    }
  } catch {
    // SPA fallback below.
  }

  const indexPath = join(distDir, 'index.html')
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  createReadStream(indexPath).pipe(res)
}

function sendChatStream(res, text) {
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  })
  const id = `chatcmpl_${randomUUID()}`
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-5.5',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    })}\n\n`,
  )
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-5.5',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`,
  )
  res.end('data: [DONE]\n\n')
}

function sendResponseStream(res, response, text) {
  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  })
  res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response })}\n\n`)
  res.write(
    `event: response.output_text.delta\ndata: ${JSON.stringify({
      type: 'response.output_text.delta',
      item_id: response.output[0].id,
      output_index: 0,
      content_index: 0,
      delta: text,
    })}\n\n`,
  )
  res.write(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`)
  res.end('data: [DONE]\n\n')
}

function makeResponseObject(body, text, usage) {
  return {
    id: `resp_${randomUUID()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: body.model || 'gpt-5.5',
    output: [
      {
        id: `msg_${randomUUID()}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [],
          },
        ],
      },
    ],
    output_text: text,
    usage,
  }
}

function makeMockText(body) {
  const prompt = JSON.stringify(body.input || body.messages || '').slice(0, 160)
  return `scgk114 本地 mock 已收到请求。上游 Pro 池尚未接入；当前仅用于验证 Key、Base URL、请求记录和 Codex 配置。请求摘要：${prompt}`
}

function estimateUsage(body, text) {
  const inputTokens = Math.max(1, Math.ceil(JSON.stringify(body).length / 4))
  const outputTokens = Math.max(1, Math.ceil(text.length / 4))

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
  }
}

function extractUsage(parsed, requestBody) {
  const usage = parsed?.usage

  if (usage && typeof usage === 'object') {
    const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0)
    const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0)
    const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens)

    return {
      completion_tokens: outputTokens,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      prompt_tokens: inputTokens,
      total_tokens: totalTokens,
    }
  }

  return estimateUsage(requestBody ?? {}, JSON.stringify(parsed ?? ''))
}

function parseMaybeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function createInviteCode(existing) {
  const existingCodes = new Set(existing.map((invite) => invite.code))
  let code = ''

  do {
    code = `SCGK-${randomChunk(4)}`
  } while (existingCodes.has(code))

  return code
}

function createInternalKey() {
  return `sk-scgk114-${randomBytes(18).toString('base64url')}`
}

function randomChunk(length) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(length)

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function maskKey(key) {
  return `${key.slice(0, 15)}...${key.slice(-4)}`
}

function formatDay(date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Origin', '*')
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data, null, 2))
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}
