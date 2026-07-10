const DATA_URL = 'https://api.scgk114.com/public/usage-summary.json';

const money = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatTokens(value) {
  return compact.format(Number(value || 0));
}

function formatCost(value) {
  return money.format(Number(value || 0));
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function renderEmpty(message) {
  document.getElementById('memberRows').innerHTML = `<tr><td colspan="7">${message}</td></tr>`;
  document.getElementById('trendChart').innerHTML = `<p class="muted-copy">${message}</p>`;
}

function renderMembers(members) {
  const rows = members.map((member) => `
    <tr>
      <td>
        <strong>${member.name}</strong>
        <span class="cell-note">${member.key_label || 'sk-***'}</span>
      </td>
      <td>${member.today_requests || 0}</td>
      <td>${formatTokens(member.today_tokens)}</td>
      <td>${formatCost(member.today_cost_cny)}</td>
      <td>${member.month_requests || 0}</td>
      <td>${formatCost(member.month_cost_cny)}</td>
      <td>${member.last_used_at || '-'}</td>
    </tr>
  `).join('');

  document.getElementById('memberRows').innerHTML = rows || '<tr><td colspan="7">暂无使用记录</td></tr>';
}

function renderTrend(days) {
  const maxCost = Math.max(...days.map((day) => Number(day.cost_cny || 0)), 0.01);
  const chart = days.map((day) => {
    const height = Math.max((Number(day.cost_cny || 0) / maxCost) * 100, 4);
    return `
      <div class="trend-column">
        <div class="trend-bar" title="${day.date} ${formatCost(day.cost_cny)}">
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

    setText('todayRequests', data.totals?.today_requests ?? 0);
    setText('todayTokens', formatTokens(data.totals?.today_tokens));
    setText('todayCost', formatCost(data.totals?.today_cost_cny));
    setText('monthCost', formatCost(data.totals?.month_cost_cny));
    badge.textContent = `更新 ${data.generated_at || '-'}`;

    renderMembers(data.members || []);
    renderTrend(data.daily || []);
  } catch (error) {
    badge.textContent = '读取失败';
    renderEmpty('公开统计暂时不可用，稍后刷新。');
    console.warn('usage summary unavailable', error);
  }
}

loadUsage();
