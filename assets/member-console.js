(function () {
  "use strict";

  const API_ORIGIN = ["127.0.0.1", "localhost"].includes(window.location.hostname)
    ? "http://127.0.0.1:8787"
    : "https://api.scgk114.com";
  const ACCESS_BASE_URL = "https://api.scgk114.com/v1";
  const CLOUD_DRIVE_URL = "https://pan.baidu.com/s/1Z5hL2lCHzCSBf2FDErANsg?pwd=hhir";
  const DEMO_ACCESS_CODES = {};

  const state = {
    sessionToken: window.localStorage.getItem("scgk114-session-token") || "",
    member: null,
    activeTab: "usage",
    manualTab: "quick",
    usage: null,
    error: "",
    notice: ""
  };

  const app = document.getElementById("app");

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return "0%";
    return `${Math.min(100, Math.max(0, value)).toFixed(1)}%`;
  }

  function safePercent(used, quota) {
    if (!quota) return 0;
    return (Number(used || 0) / Number(quota)) * 100;
  }

  function buildDemoAccount(no, name, role, keyName, memberMonthTokens, memberTodayTokens, memberMonthRequests) {
    return {
      sessionToken: `demo-session-scgk-member-${no}`,
      profile: {
        name,
        role,
        keyName
      },
      usage: {
        generated_at: "前端演示数据",
        groupMonthlyTokenQuota: 100000000,
        totals: {
          month_tokens: 24000000,
          today_tokens: 860000,
          month_requests: 318
        },
        memberUsage: {
          month_tokens: memberMonthTokens,
          today_tokens: memberTodayTokens,
          month_requests: memberMonthRequests
        },
        daily: buildDailyUsage(memberTodayTokens)
      }
    };
  }

  function buildDailyUsage(todayTokens) {
    const today = Number(todayTokens || 0);
    return [
      { label: "D-6", tokens: Math.round(today * 1.6) },
      { label: "D-5", tokens: Math.round(today * 1.9) },
      { label: "D-4", tokens: Math.round(today * 1.4) },
      { label: "D-3", tokens: Math.round(today * 2.2) },
      { label: "D-2", tokens: Math.round(today * 1.8) },
      { label: "D-1", tokens: Math.round(today * 2.4) },
      { label: "今天", tokens: today }
    ];
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${state.sessionToken}`
    };
  }

  async function apiRequest(path, options) {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `请求失败：HTTP ${response.status}`);
    }
    return data;
  }

  async function login(code) {
    const demoAccount = getDemoAccountByCode(code);
    if (demoAccount) {
      applySession(demoAccount);
      state.notice = "当前为前端演示登录码，仅用于测试页面流程。";
      renderConsole();
      return;
    }

    const data = await apiRequest("/member/login", {
      method: "POST",
      body: JSON.stringify({ code })
    });

    applySession(data);
    renderConsole();
  }

  async function restoreSession() {
    if (!state.sessionToken) {
      renderLogin();
      return;
    }

    const demoAccount = getDemoAccountByToken(state.sessionToken);
    if (demoAccount) {
      applySession(demoAccount);
      state.notice = "当前为前端演示登录码，仅用于测试页面流程。";
      renderConsole();
      return;
    }

    try {
      const me = await apiRequest("/member/me", {
        method: "GET",
        headers: authHeaders()
      });
      state.member = me.profile;
      await loadUsage();
      renderConsole();
    } catch (_) {
      logout();
    }
  }

  async function loadUsage() {
    if (!state.sessionToken) return;
    const demoAccount = getDemoAccountByToken(state.sessionToken);
    if (demoAccount) {
      state.usage = demoAccount.usage;
      state.error = "";
      return;
    }

    try {
      state.usage = await apiRequest("/member/usage", {
        method: "GET",
        headers: authHeaders()
      });
      state.error = "";
    } catch (error) {
      state.error = error.message;
    }
  }

  function logout() {
    state.sessionToken = "";
    state.member = null;
    state.usage = null;
    state.error = "";
    state.notice = "";
    window.localStorage.removeItem("scgk114-session-token");
    renderLogin();
  }

  function normalizeCode(code) {
    return String(code || "").trim().toUpperCase();
  }

  function getDemoAccountByCode(code) {
    return DEMO_ACCESS_CODES[normalizeCode(code)] || null;
  }

  function getDemoAccountByToken(token) {
    return Object.values(DEMO_ACCESS_CODES).find((account) => account.sessionToken === token) || null;
  }

  function applySession(data) {
    state.sessionToken = data.sessionToken;
    state.member = data.profile;
    state.usage = data.usage;
    state.activeTab = "usage";
    state.error = "";
    window.localStorage.setItem("scgk114-session-token", state.sessionToken);
  }

  function renderLogin(errorText) {
    app.innerHTML = `
      <main class="login-shell">
        <section class="login-info">
          <div class="brand-row">
            <div class="brand-mark">S</div>
            <div>
              <strong>SCGK114</strong>
              <span>课题组 AI 接入服务</span>
            </div>
          </div>

          <div class="login-copy">
            <p class="eyebrow">成员登录码</p>
            <h1>输入专属登录码，查看自己的接入与用量</h1>
            <p>每位组员拥有独立登录码和接入信息。进入后可查看个人用量、组内总额度占比，以及统一的 Base URL 和接入说明。</p>
          </div>

          <div class="login-points">
            <article class="point-card">
              <strong>一人一号</strong>
              <span>每位成员绑定自己的 Key，便于统计、排查和停用。</span>
            </article>
            <article class="point-card">
              <strong>先看用量</strong>
              <span>登录后的第一个界面就是个人用量和组内额度占比。</span>
            </article>
            <article class="point-card">
              <strong>专属接入</strong>
              <span>API Key 由管理员单独分发，请妥善保管。</span>
            </article>
          </div>
        </section>

        <section class="login-card-wrap">
          <form class="login-card" id="login-form">
            <p class="eyebrow">LOGIN CODE</p>
            <h2>成员入口</h2>
            <p class="muted">请输入管理员发放的专属登录码。</p>
            <label for="login-code">登录码</label>
            <div class="code-row">
              <input id="login-code" name="login-code" autocomplete="one-time-code" placeholder="例如 SCGK-7F2K-Q9MD-X3PA" />
              <button class="primary" type="submit">进入</button>
            </div>
            <p class="error-text">${escapeHtml(errorText || "")}</p>
            <div class="demo-codes">
              <p class="muted">登录码由管理员按成员单独分发。</p>
            </div>
          </form>
        </section>
      </main>
    `;

    document.getElementById("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      button.disabled = true;
      button.textContent = "验证中";
      try {
        await login(document.getElementById("login-code").value);
      } catch (error) {
        renderLogin(error.message || "登录失败，请检查登录码。");
      }
    });
  }

  function navButton(id, label) {
    const active = state.activeTab === id ? " active" : "";
    return `<button class="tab-button${active}" type="button" data-tab="${id}"><span>${label}</span></button>`;
  }

  function renderConsole() {
    if (!state.member) {
      renderLogin();
      return;
    }

    app.innerHTML = `
      <main class="console-shell">
        <aside class="sidebar">
          <div class="brand-row">
            <div class="brand-mark">S</div>
            <div>
              <strong>SCGK114</strong>
              <span>成员控制台</span>
            </div>
          </div>
          <nav class="nav">
            ${navButton("usage", "个人用量")}
            ${navButton("access", "接入和安装")}
            ${navButton("manual", "使用文档")}
            ${navButton("docs", "说明")}
            ${navButton("support", "反馈")}
          </nav>
          <div class="sidebar-bottom">
            <div class="member-pill">
              <strong>${escapeHtml(state.member.name)}</strong>
              <span>${escapeHtml(state.member.role)}</span>
              <span>${escapeHtml(state.member.keyName)}</span>
            </div>
            <button class="ghost" type="button" id="logout-button">退出</button>
          </div>
        </aside>

        <section class="workspace">
          ${renderTopbar()}
          ${state.error ? `<div class="notice">${escapeHtml(state.error)}</div>` : ""}
          ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ""}
          ${renderActiveView()}
        </section>
      </main>
    `;

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", async () => {
        state.activeTab = button.dataset.tab;
        if (state.activeTab === "usage") await loadUsage();
        state.notice = "";
        renderConsole();
      });
    });

    document.getElementById("logout-button").addEventListener("click", logout);

    const refreshButton = document.getElementById("refresh-usage");
    if (refreshButton) {
      refreshButton.addEventListener("click", async () => {
        refreshButton.disabled = true;
        refreshButton.textContent = "刷新中";
        await loadUsage();
        state.notice = "用量已刷新。";
        renderConsole();
      });
    }

    const copyButton = document.getElementById("copy-base");
    if (copyButton) copyButton.addEventListener("click", copyBaseUrl);

    document.querySelectorAll("[data-manual-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.manualTab = button.dataset.manualTab;
        renderConsole();
      });
    });
  }

  function renderTopbar() {
    const titles = {
      usage: "用量",
      access: "接入和安装",
      manual: "使用文档",
      docs: "使用说明",
      support: "问题反馈"
    };

    const generated = state.usage && state.usage.generated_at ? state.usage.generated_at : "正在读取";
    return `
      <header class="topbar">
        <div>
          <p class="member-kicker">当前成员：<strong>${escapeHtml(state.member.name)}</strong></p>
          <h1>${titles[state.activeTab]}</h1>
          <p class="muted">数据更新时间：${escapeHtml(generated)}</p>
        </div>
      </header>
    `;
  }

  function renderActiveView() {
    if (state.activeTab === "access") return renderAccess();
    if (state.activeTab === "manual") return renderManual();
    if (state.activeTab === "docs") return renderDocs();
    if (state.activeTab === "support") return renderSupport();
    return renderUsage();
  }

  function renderUsage() {
    const memberUsage = state.usage ? state.usage.memberUsage : null;
    const totals = state.usage ? state.usage.totals || {} : {};
    const groupQuota = state.usage ? state.usage.groupMonthlyTokenQuota : 0;
    const ownMonthTokens = memberUsage ? memberUsage.month_tokens : 0;
    const ownTodayTokens = memberUsage ? memberUsage.today_tokens : 0;
    const ownRequests = memberUsage ? memberUsage.month_requests : 0;
    const groupMonthTokens = totals.month_tokens || 0;
    const groupPercent = safePercent(groupMonthTokens, groupQuota);
    const groupShare = safePercent(ownMonthTokens, groupMonthTokens);

    return `
      <div class="view-stack">
        <section class="metrics-grid">
          ${metric("本月个人 Tokens", formatNumber(ownMonthTokens), `约 ${formatCompact(ownMonthTokens)}`)}
          ${metric("今日个人 Tokens", formatNumber(ownTodayTokens), "今天已经记录的个人使用量")}
          ${metric("本月个人请求", formatNumber(ownRequests), "按该成员专属 Key 统计")}
          ${sharePieCard(groupShare)}
        </section>

        <div class="split">
          <section class="panel">
            <div class="section-heading">
            <div>
              <p class="eyebrow">最近 7 天</p>
              <h2>组内整体趋势</h2>
            </div>
          </div>
            ${renderDailyChart()}
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">当前身份</p>
                <h2>成员绑定信息</h2>
              </div>
            </div>
            <div class="access-card">
              ${infoBox("成员", state.member.name)}
              ${infoBox("绑定 Key", state.member.keyName)}
              ${infoBox("权限", state.member.role)}
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function metric(label, value, detail) {
    return `
      <article class="metric-card">
        <span>${label}</span>
        <strong>${value}</strong>
        <p>${detail}</p>
      </article>
    `;
  }

  function sharePieCard(percent) {
    const display = formatPercent(percent);
    const value = Math.min(100, Math.max(0, percent || 0));
    return `
      <article class="metric-card pie-metric">
        <div class="pie-chart" style="--pie-value: ${value}%">
          <span>${display}</span>
        </div>
        <div>
          <span>组内使用占比</span>
          <strong>${display}</strong>
          <p>个人占全组本月已用量</p>
        </div>
      </article>
    `;
  }

  function progress(label, used, quota, percent) {
    return `
      <div class="progress-row">
        <div class="progress-meta">
          <span>${label}</span>
          <span>${formatPercent(percent)}</span>
        </div>
        <div class="bar" style="--value: ${formatPercent(percent)}"><span></span></div>
      </div>
    `;
  }

  function renderDailyChart() {
    const rows = state.usage && Array.isArray(state.usage.daily) ? state.usage.daily : [];
    if (!rows.length) return `<p class="muted">正在读取或暂无数据。</p>`;

    const values = rows.map((row) => Number(row.tokens || 0));
    const max = Math.max(...values, 1);
    const width = 620;
    const height = 250;
    const padX = 42;
    const padY = 28;
    const chartWidth = width - padX * 2;
    const chartHeight = height - padY * 2;
    const yTicks = [1, 0.5, 0].map((ratio) => {
      const y = padY + chartHeight - ratio * chartHeight;
      return {
        y,
        label: formatCompact(max * ratio)
      };
    });
    const points = rows.map((row, index) => {
      const x = rows.length === 1 ? width / 2 : padX + (chartWidth * index) / (rows.length - 1);
      const y = padY + chartHeight - (Number(row.tokens || 0) / max) * chartHeight;
      return { x, y, row };
    });
    const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const areaPoints = `${padX},${height - padY} ${linePoints} ${width - padX},${height - padY}`;

    return `
      <div class="line-chart-wrap">
        <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="最近 7 天组内用量趋势">
          ${yTicks.map((tick) => `
            <line class="grid-line" x1="${padX}" y1="${tick.y.toFixed(1)}" x2="${width - padX}" y2="${tick.y.toFixed(1)}"></line>
            <text class="y-axis-label" x="${padX - 10}" y="${tick.y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escapeHtml(tick.label)}</text>
          `).join("")}
          <line class="axis-line" x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}"></line>
          <line class="axis-line" x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}"></line>
          <polygon class="trend-area" points="${areaPoints}"></polygon>
          <polyline class="trend-line" points="${linePoints}"></polyline>
          ${points.map((point) => `
            <circle class="trend-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4"></circle>
            <text class="chart-label" x="${point.x.toFixed(1)}" y="${height - 6}" text-anchor="middle">${escapeHtml(point.row.label || point.row.date)}</text>
          `).join("")}
        </svg>
        <div class="chart-summary">
          ${points.map((point) => `
            <div>
              <span>${escapeHtml(point.row.label || point.row.date)}</span>
              <strong>${formatCompact(point.row.tokens)}</strong>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  function formatCompact(value) {
    const number = Number(value || 0);
    if (number >= 100000000) return `${(number / 100000000).toFixed(1)}亿`;
    if (number >= 10000) return `${(number / 10000).toFixed(1)}万`;
    return formatNumber(number);
  }

  function renderAccess() {
    return `
      <div class="view-stack">
        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">专属接入信息</p>
              <h2>管理员统一分发 API Key</h2>
            </div>
          </div>
          <div class="notice">API Key 由管理员分发，请妥善保管。网页不会显示、生成或导出 API Key。</div>
          <div class="download-strip">
            <div>
              <strong>SCGK114 Codex 安装配置包</strong>
              <span>包含 Windows 官方安装入口、自动配置脚本、离线 CLI 和图片生成 Skill。</span>
            </div>
            <a class="secondary link-button ${CLOUD_DRIVE_URL === "#" ? "disabled" : ""}" href="${CLOUD_DRIVE_URL}" target="_blank" rel="noreferrer">下载安装配置包</a>
          </div>
        </section>

        <div class="split">
          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">OpenAI-compatible</p>
                <h2>客户端填写</h2>
              </div>
              <button class="secondary" type="button" id="copy-base">复制 Base URL</button>
            </div>
            <div class="access-card">
              ${infoBox("Base URL", ACCESS_BASE_URL)}
              ${infoBox("API Key", "由管理员单独分发，请妥善保管")}
              ${infoBox("推荐文本模型", "gpt-5.4-mini / gpt-5.4 / gpt-5.5")}
              ${infoBox("复杂任务模型", "gpt-5.6-terra")}
            </div>
          </section>

          <section class="panel">
            <div class="section-heading">
              <div>
                <p class="eyebrow">安全口径</p>
                <h2>仅供组内使用，切勿外传</h2>
              </div>
            </div>
            <div class="plain-rules">
              <p>每位成员使用独立 Key，只用于本人组内工作。</p>
              <p>非特殊情况请勿对外分享本网页。</p>
              <p>请勿转发给其他人，也不要上传到公开代码仓库或截图中。</p>
              <p>如怀疑泄露，请联系管理员重置；旧 Key 会被停用。</p>
            </div>
          </section>
        </div>
      </div>
    `;
  }

  function renderDocs() {
    return `
      <div class="view-stack">
        <section class="guide-grid">
          <article class="guide-card">
            <h3>第一步：填写接入信息</h3>
            <p>在 Codex 或兼容客户端中填写统一 Base URL 和管理员分发的 API Key，先测试一句简单问答。</p>
          </article>
          <article class="guide-card">
            <h3>第二步：选择模型</h3>
            <p>普通任务优先使用轻量模型，复杂科研分析再切换到高强度模型。</p>
          </article>
          <article class="guide-card">
            <h3>第三步：反馈问题</h3>
            <p>遇到 403、断连或模型不可用时，截图保留时间、模型名和任务描述。</p>
          </article>
        </section>

        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">图片生成</p>
              <h2>不要把图片模型设为主模型</h2>
            </div>
          </div>
          <div class="notice">图片生成请使用管理员提供的 scgk-imagegen 工具，接口走 /v1/images/generations。Codex 主模型继续使用文本模型。</div>
        </section>
      </div>
    `;
  }

  function renderManual() {
    const tabs = [
      ["quick", "快速开始"],
      ["codex", "Codex 接入"],
      ["cpp", "C++ 调用"],
      ["workflow", "推荐工作方式"],
      ["prompts", "常用提示词"],
      ["faq", "常见问题"]
    ];
    const active = state.manualTab || "quick";

    return `
      <div class="view-stack">
        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">成员手册</p>
              <h2>从接入到高效使用</h2>
            </div>
          </div>
          <div class="manual-tabs" role="tablist" aria-label="使用文档章节">
            ${tabs.map(([id, label]) => `
              <button class="manual-tab${active === id ? " active" : ""}" type="button" data-manual-tab="${id}" role="tab" aria-selected="${active === id ? "true" : "false"}">${label}</button>
            `).join("")}
          </div>
          ${renderManualTab(active)}
        </section>

        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">基础概念</p>
              <h2>AI 常用术语说明</h2>
            </div>
          </div>
          <div class="term-grid">
            <article class="term-card">
              <h3>LLM <small>Large Language Model · 大语言模型</small></h3>
              <p>大语言模型，能够理解和生成自然语言、代码、表格说明等内容。</p>
              <span>简单理解：一个读过很多资料、能按要求写作和分析的助手。</span>
            </article>
            <article class="term-card">
              <h3>RAG <small>Retrieval-Augmented Generation · 检索增强生成</small></h3>
              <p>检索增强生成，先从指定资料库中找相关内容，再让模型基于这些材料回答。</p>
              <span>简单理解：先翻资料再回答，减少凭空编造。</span>
            </article>
            <article class="term-card">
              <h3>Skill <small>Reusable Skill · 可复用技能</small></h3>
              <p>可复用的任务能力包，里面可以包含步骤说明、模板、脚本和专用工具。</p>
              <span>简单理解：给 AI 装一个专门处理某类工作的工具箱。</span>
            </article>
            <article class="term-card">
              <h3>MCP <small>Model Context Protocol · 模型上下文协议</small></h3>
              <p>模型上下文协议，用来把外部工具、文件、数据库或网页能力接入 AI 工作流。</p>
              <span>简单理解：让 AI 能安全调用外部工具的一套接口规则。</span>
            </article>
            <article class="term-card">
              <h3>Token <small>Text Token · 文本计量单位</small></h3>
              <p>模型处理文本的基本计量单位，输入和输出都会消耗 token。</p>
              <span>简单理解：AI 阅读和写字时使用的字数计量尺。</span>
            </article>
            <article class="term-card">
              <h3>Context <small>上下文，不是 Text</small></h3>
              <p>模型当前能看到的对话、文件、代码和说明，决定它能依据什么材料来回答。</p>
              <span>简单理解：你摊在桌面上给 AI 看的全部材料。</span>
            </article>
          </div>
        </section>
      </div>
    `;
  }

  function renderManualTab(active) {
    const views = {
      quick: renderManualQuickStart,
      codex: renderManualCodex,
      cpp: renderManualCpp,
      workflow: renderManualWorkflow,
      prompts: renderManualPrompts,
      faq: renderManualFaq
    };
    return (views[active] || renderManualQuickStart)();
  }

  function renderManualQuickStart() {
    return `
      <div class="manual-section">
        <div class="manual-grid three">
          ${manualCard("1. 登录成员控制台", "打开 scgk114.com，输入管理员分发的前端登录码，查看自己的绑定 Key 和用量。")}
          ${manualCard("2. 配置客户端", "在 Codex、C++ 程序或兼容客户端中填写 Base URL 和 API Key。")}
          ${manualCard("3. 先跑一句测试", "先发送一句简单问题，确认模型可用后再开始论文、代码或数据任务。")}
        </div>
        <div class="manual-note">Base URL：${ACCESS_BASE_URL}。API Key 不在网页显示，由管理员单独分发，请妥善保管。</div>
      </div>
    `;
  }

  function renderManualCodex() {
    return `
      <div class="manual-section">
        <div class="access-card">
          ${infoBox("Base URL", ACCESS_BASE_URL)}
          ${infoBox("API Key", "填写管理员分发的 sk-...")}
          ${infoBox("日常文本模型", "gpt-5.4-mini / gpt-5.4 / gpt-5.5")}
          ${infoBox("复杂任务模型", "gpt-5.6-terra")}
        </div>
        <div class="manual-grid">
          ${manualCard("推荐配置顺序", "先确认 Base URL，再填 API Key，最后选择文本模型。图片生成不要设置为 Codex 主模型。")}
          ${manualCard("图片生成", "使用 scgk-imagegen 工具，接口走 /v1/images/generations；普通对话继续使用文本模型。")}
        </div>
      </div>
    `;
  }

  function renderManualCpp() {
    return `
      <div class="manual-section">
        <div class="code-panel">
          <div><span>Base URL</span><code>${ACCESS_BASE_URL}</code></div>
          <div><span>文本接口</span><code>/responses</code></div>
          <div><span>图片接口</span><code>/images/generations</code></div>
        </div>
        <div class="prompt-block">
          <strong>C++ 调用时给 Codex 的提示</strong>
          <pre>请帮我在当前 C++ 项目中接入 OpenAI-compatible API。
Base URL 使用 https://api.scgk114.com/v1。
API Key 从环境变量 SCGK_API_KEY 读取。
文本模型优先使用 gpt-5.5。
请先写一个最小可运行测试，再说明如何编译和运行。</pre>
        </div>
      </div>
    `;
  }

  function renderManualWorkflow() {
    return `
      <div class="manual-section">
        <div class="manual-grid">
          ${manualCard("先说目标", "先告诉 AI 你要解决什么问题、已有材料是什么、希望输出什么格式。")}
          ${manualCard("分步推进", "复杂任务先让 AI 理解材料和列计划，再让它执行，不要一口气塞满所有要求。")}
          ${manualCard("保留检查点", "长任务要求 AI 阶段性总结：改了什么、文件在哪、还有什么风险。")}
          ${manualCard("主动纠偏", "发现方向不对时直接指出错在哪里，让 AI 按新的约束继续。")}
        </div>
      </div>
    `;
  }

  function renderManualPrompts() {
    return `
      <div class="manual-section">
        ${promptExample("论文阅读", "请帮我阅读这篇论文，输出：研究问题、方法路线、关键实验、创新点、可能复现难点。")}
        ${promptExample("代码检查", "请检查这段代码：是否有明显 bug、性能问题、可简化处，并给出修改后的完整版本。")}
        ${promptExample("实验数据", "请把这组实验数据整理成：数据趋势、异常点、可能原因、下一步实验建议。")}
        ${promptExample("项目交接", "请根据当前项目内容生成交接文档，包含当前状态、关键文件、部署方式、测试结果和下一步任务。")}
      </div>
    `;
  }

  function renderManualFaq() {
    return `
      <div class="manual-section">
        <div class="faq-list">
          ${faqItem("API Key 填在哪里？", "填在 Codex 或兼容客户端的 API Key 字段，不要发到公开聊天或代码仓库。")}
          ${faqItem("页面用量为什么不是实时跳动？", "用量来自后台日志统计，可能有短暂延迟。需要时点击个人用量页的刷新按钮。")}
          ${faqItem("调用时出现 401 或 403 怎么办？", "通常与 API Key、模型权限或图片接口使用方式有关。截图并保留模型名、报错文字和发生时间。")}
          ${faqItem("Key 泄露怎么办？", "立即联系管理员停用并更换。旧 Key 停用后无法继续访问。")}
        </div>
      </div>
    `;
  }

  function manualCard(title, body) {
    return `
      <article class="manual-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(body)}</p>
      </article>
    `;
  }

  function promptExample(title, body) {
    return `
      <article class="prompt-block">
        <strong>${escapeHtml(title)}</strong>
        <pre>${escapeHtml(body)}</pre>
      </article>
    `;
  }

  function faqItem(question, answer) {
    return `
      <article class="faq-item">
        <h3>${escapeHtml(question)}</h3>
        <p>${escapeHtml(answer)}</p>
      </article>
    `;
  }

  function renderSupport() {
    return `
      <div class="view-stack">
        <section class="panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">反馈格式</p>
              <h2>遇到问题请保留这些信息</h2>
            </div>
          </div>
          <pre>成员：${escapeHtml(state.member.name)}
时间：
客户端：
模型：
错误截图：
任务描述：
是否重复出现：</pre>
        </section>
      </div>
    `;
  }

  function infoBox(label, value) {
    return `
      <div class="endpoint-box">
        <span>${escapeHtml(label)}</span>
        <code>${escapeHtml(value)}</code>
      </div>
    `;
  }

  async function copyBaseUrl() {
    try {
      await navigator.clipboard.writeText(ACCESS_BASE_URL);
      state.notice = "Base URL 已复制。";
      renderConsole();
    } catch (_) {
      window.alert("复制失败，请手动复制。");
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  restoreSession();
})();
