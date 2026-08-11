"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8790);
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://scgk114.com";
const UPSTREAM_BASE_URL = (process.env.SCGK_IMAGE_UPSTREAM_BASE_URL || "http://sub2api:8080/v1").replace(/\/$/, "");
const UPSTREAM_KEY = process.env.SCGK_IMAGE_SERVICE_KEY || "";
const IMAGE_MODEL = process.env.SCGK_IMAGE_MODEL || "gpt-image-2";
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || "/data/generated";
const STATIC_DIR = process.env.IMAGE_STATIC_DIR || (fs.existsSync(path.join(__dirname, "public")) ? path.join(__dirname, "public") : path.join(__dirname, "..", "image"));
const TASK_TTL_MS = Number(process.env.IMAGE_TASK_TTL_MS || 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.IMAGE_REQUEST_TIMEOUT_MS || 180 * 1000);
const MAX_BODY_BYTES = Number(process.env.IMAGE_MAX_BODY_BYTES || 64 * 1024);
const MAX_PROMPT_LENGTH = Number(process.env.IMAGE_MAX_PROMPT_LENGTH || 2000);
const IP_WINDOW_MS = Number(process.env.IMAGE_IP_WINDOW_MS || 15 * 60 * 1000);
const IP_MAX_REQUESTS = Number(process.env.IMAGE_IP_MAX_REQUESTS || 4);
const VISITOR_MAX_REQUESTS = Number(process.env.IMAGE_VISITOR_MAX_REQUESTS || 3);
const GLOBAL_CONCURRENCY = Number(process.env.IMAGE_GLOBAL_CONCURRENCY || 1);
const QUEUE_MAX = Number(process.env.IMAGE_QUEUE_MAX || 6);

const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high"]);
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const tasks = new Map();
const downloads = new Map();
const queue = [];
const rateWindows = new Map();
let activeCount = 0;

function now() {
  return Date.now();
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

function text(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(value);
}

function publicError(status, code, message, retryAfter) {
  const body = { error: { code, message } };
  if (retryAfter) body.error.retryAfter = retryAfter;
  return { status, body };
}

function requestIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function visitorId(req) {
  const value = String(req.headers["x-scgk-visitor"] || "").trim();
  return /^[a-zA-Z0-9_-]{16,96}$/.test(value) ? value : "anonymous";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function allowRate(key, limit) {
  const cutoff = now() - IP_WINDOW_MS;
  const entries = (rateWindows.get(key) || []).filter((stamp) => stamp > cutoff);
  if (entries.length >= limit) {
    rateWindows.set(key, entries);
    return false;
  }
  entries.push(now());
  rateWindows.set(key, entries);
  return true;
}

function normalizePrompt(input) {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
}

function safeTask(task) {
  const result = {
    taskId: task.id,
    status: task.status,
    createdAt: task.createdAt,
    queuePosition: task.status === "queued" ? Math.max(1, queue.indexOf(task.id) + 1) : undefined
  };
  if (task.status === "completed") {
    result.images = task.images.map((image) => ({
      url: `/api/image/files/${image.token}`,
      downloadUrl: `/api/image/files/${image.token}?download=1`
    }));
  }
  if (task.status === "failed") result.message = task.message;
  return result;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw publicError(413, "payload_too_large", "提交内容过大，请缩短描述后重试。");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw publicError(400, "invalid_request", "提交内容格式不正确，请刷新页面后重试。");
  }
}

function startQueuedTasks() {
  while (activeCount < GLOBAL_CONCURRENCY && queue.length) {
    const taskId = queue.shift();
    const task = tasks.get(taskId);
    if (!task || task.status !== "queued") continue;
    activeCount += 1;
    task.status = "running";
    runTask(task)
      .catch((error) => finishFailure(task, error))
      .finally(() => {
        activeCount -= 1;
        startQueuedTasks();
      });
  }
}

async function fetchImageFromUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:") throw new Error("invalid_result_url");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("result_download_failed");
    const type = response.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) throw new Error("invalid_result_type");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error("invalid_result_size");
    return { buffer, type };
  } finally {
    clearTimeout(timeout);
  }
}

async function persistImage(task, index, item) {
  let buffer;
  let type = "image/png";
  if (typeof item.b64_json === "string" && item.b64_json.length) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (typeof item.url === "string" && item.url.length) {
    const downloaded = await fetchImageFromUrl(item.url);
    buffer = downloaded.buffer;
    type = downloaded.type;
  } else {
    throw new Error("missing_image_result");
  }
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error("invalid_result_size");
  const extension = type.includes("webp") ? "webp" : type.includes("jpeg") ? "jpg" : "png";
  const token = crypto.randomBytes(24).toString("base64url");
  const filename = `${task.id}-${index}.${extension}`;
  const filePath = path.join(OUTPUT_DIR, filename);
  await fsp.writeFile(filePath, buffer, { mode: 0o600 });
  downloads.set(token, { filePath, type, expiresAt: now() + TASK_TTL_MS });
  return { token };
}

function mapUpstreamFailure(status) {
  if (status === 429) return new Error("rate_limited");
  if (status === 408 || status === 504) return new Error("timeout");
  return new Error("upstream_failed");
}

async function runTask(task) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const payload = {
      model: IMAGE_MODEL,
      prompt: task.prompt,
      size: task.size,
      quality: task.quality,
      n: task.n
    };
    const response = await fetch(`${UPSTREAM_BASE_URL}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${UPSTREAM_KEY}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw mapUpstreamFailure(response.status);
    const result = await response.json();
    if (!Array.isArray(result.data) || !result.data.length) throw new Error("empty_result");
    task.images = [];
    for (let index = 0; index < result.data.length; index += 1) {
      task.images.push(await persistImage(task, index, result.data[index] || {}));
    }
    task.status = "completed";
    console.info(JSON.stringify({ event: "image_task_completed", task: task.id, ip: task.ipHash, count: task.images.length }));
  } finally {
    clearTimeout(timer);
  }
}

function finishFailure(task, error) {
  const message = error?.name === "AbortError" || error?.message === "timeout"
    ? "生成耗时较长，请调整描述后重试。"
    : error?.message === "rate_limited"
      ? "当前生成任务较多，请稍后再试。"
      : "生成暂时未完成，请调整描述后重试。";
  task.status = "failed";
  task.message = message;
  console.warn(JSON.stringify({ event: "image_task_failed", task: task.id, ip: task.ipHash, reason: error?.message || "unknown" }));
}

function scheduleCleanup() {
  const cutoff = now() - TASK_TTL_MS;
  for (const [taskId, task] of tasks) {
    if (task.createdAt < cutoff && task.status !== "running" && task.status !== "queued") tasks.delete(taskId);
  }
  for (const [token, file] of downloads) {
    if (file.expiresAt >= now()) continue;
    downloads.delete(token);
    fsp.unlink(file.filePath).catch(() => {});
  }
  for (const [key, entries] of rateWindows) {
    const remaining = entries.filter((stamp) => stamp > now() - IP_WINDOW_MS);
    if (remaining.length) rateWindows.set(key, remaining);
    else rateWindows.delete(key);
  }
}

function serveStatic(req, res, pathname) {
  const relativePath = pathname === "/image" || pathname === "/image/" ? "index.html" : pathname.replace(/^\/image\//, "");
  const normalized = path.normalize(relativePath).replace(/^([.][.][\\/])+/, "");
  const filePath = path.join(STATIC_DIR, normalized);
  if (!filePath.startsWith(STATIC_DIR)) return text(res, 403, "Forbidden");
  fs.readFile(filePath, (error, content) => {
    if (error) return text(res, 404, "Not found");
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    });
    res.end(content);
  });
}

async function handleGenerate(req, res) {
  if (!UPSTREAM_KEY) return json(res, 503, publicError(503, "service_unavailable", "图片服务正在准备中，请稍后再试。").body);
  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    return json(res, error.status, error.body);
  }
  const prompt = normalizePrompt(payload.prompt);
  const size = ALLOWED_SIZES.has(payload.size) ? payload.size : "1024x1024";
  const quality = ALLOWED_QUALITIES.has(payload.quality) ? payload.quality : "medium";
  const n = Number.isInteger(payload.n) && payload.n >= 1 && payload.n <= 2 ? payload.n : 1;
  if (prompt.length < 3 || prompt.length > MAX_PROMPT_LENGTH) {
    return json(res, 400, publicError(400, "invalid_prompt", "请填写 3 到 2000 个字符的图片描述。").body);
  }
  const ip = requestIp(req);
  const visitor = visitorId(req);
  const fingerprint = hash(`${visitor}|${prompt}|${size}|${quality}|${n}`);
  for (const task of tasks.values()) {
    if (task.fingerprint === fingerprint && now() - task.createdAt < 30_000) return json(res, 202, safeTask(task));
  }
  if (!allowRate(`ip:${ip}`, IP_MAX_REQUESTS) || !allowRate(`visitor:${visitor}`, VISITOR_MAX_REQUESTS)) {
    return json(res, 429, publicError(429, "too_many_requests", "当前请求较频繁，请稍后再试。", Math.ceil(IP_WINDOW_MS / 1000)).body);
  }
  const activeForVisitor = Array.from(tasks.values()).some((task) => task.visitor === visitor && (task.status === "queued" || task.status === "running"));
  if (activeForVisitor) {
    return json(res, 409, publicError(409, "visitor_busy", "当前任务仍在处理中，请等待完成后再提交。").body);
  }
  if (queue.length >= QUEUE_MAX) {
    return json(res, 429, publicError(429, "queue_full", "当前生成任务较多，请稍后再试。", 60).body);
  }
  const task = {
    id: crypto.randomUUID(),
    visitor,
    ipHash: hash(ip),
    fingerprint,
    prompt,
    size,
    quality,
    n,
    createdAt: now(),
    status: "queued",
    images: []
  };
  tasks.set(task.id, task);
  queue.push(task.id);
  console.info(JSON.stringify({ event: "image_task_queued", task: task.id, ip: task.ipHash }));
  startQueuedTasks();
  return json(res, 202, safeTask(task));
}

function handleTask(req, res, taskId) {
  const task = tasks.get(taskId);
  if (!task) return json(res, 404, publicError(404, "task_not_found", "任务已过期，请重新生成。").body);
  return json(res, 200, safeTask(task));
}

function handleDownload(req, res, token, url) {
  const record = downloads.get(token);
  if (!record || record.expiresAt < now()) return text(res, 404, "Not found");
  const isDownload = url.searchParams.get("download") === "1";
  res.writeHead(200, {
    "Content-Type": record.type,
    "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="scgk-image.${record.type.includes("webp") ? "webp" : record.type.includes("jpeg") ? "jpg" : "png"}"`,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(record.filePath).on("error", () => text(res, 404, "Not found")).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);
  // Caddy normally removes /api/image; accept the unstripped form as well.
  const pathname = url.pathname.startsWith("/api/image/")
    ? url.pathname.slice("/api/image".length)
    : url.pathname;
  if (req.method === "GET" && pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "POST" && pathname === "/generate") return handleGenerate(req, res);
  const taskMatch = pathname.match(/^\/tasks\/([a-f0-9-]{36})$/i);
  if (req.method === "GET" && taskMatch) return handleTask(req, res, taskMatch[1]);
  const fileMatch = pathname.match(/^\/files\/([a-zA-Z0-9_-]{20,})$/);
  if (req.method === "GET" && fileMatch) return handleDownload(req, res, fileMatch[1], url);
  if (req.method === "GET" && (pathname === "/image" || pathname.startsWith("/image/"))) return serveStatic(req, res, pathname);
  return json(res, 404, publicError(404, "not_found", "请求不存在。").body);
});

async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  if (!UPSTREAM_KEY) console.warn(JSON.stringify({ event: "image_service_key_missing" }));
  server.listen(PORT, "0.0.0.0", () => console.info(JSON.stringify({ event: "image_service_started", port: PORT, model: IMAGE_MODEL })));
  setInterval(scheduleCleanup, 10 * 60 * 1000).unref();
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "image_service_start_failed", reason: error?.message || "unknown" }));
  process.exit(1);
});
