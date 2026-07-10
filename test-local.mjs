const baseUrl = process.env.SCGK_BASE_URL || 'http://127.0.0.1:8787'
const apiKey = process.env.SCGK_API_KEY || 'sk-scgk114-test-local'

const health = await getJson('/api/health')
const models = await getJson('/v1/models', true)
const response = await postJson(
  '/v1/responses',
  {
    input: '请用一句话回复：scgk114 mock 后端已经连通。',
    model: 'gpt-5.5',
  },
  true,
)

console.log(
  JSON.stringify(
    {
      baseUrl: health.baseUrl,
      health: health.ok,
      models: models.data.map((model) => model.id),
      response: response.output_text,
      status: response.status,
    },
    null,
    2,
  ),
)

async function getJson(path, withAuth = false) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(withAuth),
  })

  return parseResponse(res)
}

async function postJson(path, body, withAuth = false) {
  const res = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      ...authHeaders(withAuth),
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  return parseResponse(res)
}

async function parseResponse(res) {
  const json = await res.json()

  if (!res.ok) {
    throw new Error(JSON.stringify(json))
  }

  return json
}

function authHeaders(enabled) {
  return enabled ? { Authorization: `Bearer ${apiKey}` } : {}
}
