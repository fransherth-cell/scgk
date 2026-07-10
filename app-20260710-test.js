const DATA_URL = 'https://api.scgk114.com/public/usage-summary.json';

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatTokens(value) {
  return compact.format(Number(value || 0));
}

function formatCost(value, unit = 'actual_cost') {
  const amount = Number(value || 0);
  const digits = amount > 0 && amount < 1 ? 4 : 2;
  return `${amount.toFixed(digits)} ${unit}`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderEmpty(message) {
  document.getElementById('memberRows').innerHTML = `<tr><td colspan="7">${message}</td></tr>`;
  document.getElementById('trendChart').innerHTML = `<p class="muted-copy">${message}</p>`;
}

function readCost(source, name) {
  return source?.[`${name}_actual_cost`] ?? source?.[`${name}_cost`] ?? source?.[`${name}_cost_cny`] ?? 0;
}

function renderMembers(members, unit) {
  const rows = members.map((member) => `
    <tr>
      <td>
        <strong>${member.name}</strong>
        <span class="cell-note">${member.key_label || 'sk-***'}</span>
      </td>
      <td>${member.today_requests || 0}</td>
      <td>${formatTokens(member.today_tokens)}</td>
      <td>${formatCost(readCost(member, 'today'), unit)}</td>
      <td>${member.month_requests || 0}</td>
      <td>${formatCost(readCost(member, 'month'), unit)}</td>
      <td>${member.last_used_at || '-'}</td>
    </tr>
  `).join('');

  document.getElementById('memberRows').innerHTML = rows || '<tr><td colspan="7">暂无使用记录</td></tr>';
}

function renderTrend(days, unit) {
  const maxCost = Math.max(...days.map((day) => Number(day.actual_cost ?? day.cost ?? day.cost_cny ?? 0)), 0.01);
  const chart = days.map((day) => {
    const cost = Number(day.actual_cost ?? day.cost ?? day.cost_cny ?? 0);
    const height = Math.max((cost / maxCost) * 100, 4);
    return `
      <div class="trend-column">
        <div class="trend-bar" title="${day.date} ${formatCost(cost, unit)}">
          <span style="height:${height}%"></span>
        </div>
        <small>${day.label || day.date.slice(5)}</small>
      </div>
    `;
  }).join('');

  document.getElementById('trendChart').innerHTML = chart || '<p class="muted-copy">暂无趋势数据</p>';
}

async function loadUsage() {
  const badge = document.getElementById('refreshBadge');
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const unit = data.cost_unit || data.currency || 'actual_cost';

    setText('todayRequests', data.totals?.today_requests ?? 0);
    setText('todayTokens', formatTokens(data.totals?.today_tokens));
    setText('todayCost', formatCost(readCost(data.totals, 'today'), unit));
    setText('monthCost', formatCost(readCost(data.totals, 'month'), unit));
    badge.textContent = `更新 ${data.generated_at || '-'}`;

    renderMembers(data.members || [], unit);
    renderTrend(data.daily || [], unit);
  } catch (error) {
    badge.textContent = '读取失败';
    renderEmpty('公开统计暂时不可用，稍后刷新。');
    console.warn('usage summary unavailable', error);
  }
}

function bindKeyReminder() {
  const link = document.querySelector('[data-key-link]');
  if (!link) return;

  link.addEventListener('click', (event) => {
    event.preventDefault();
    window.alert([
      '测试 Key 不在公开说明书页面直接展示。',
      '',
      '请向管理员一对一领取自己的测试 Key。',
      '拿到后只填到自己的 Codex 配置里，不要发群里或截图外传。',
      '测试阶段不要跑大批量任务；怀疑泄露时立即联系管理员重置。'
    ].join('\n'));
  });
}

bindKeyReminder();
loadUsage();
