let DATA = null;
let LAST_RESULTS = [];
let LAST_ORDER_ID = "";

const $ = (id) => document.getElementById(id);

function splitTerms(value) {
  return (value || "").replaceAll("，", ",").split(",").map((x) => x.trim()).filter(Boolean);
}

function containsAny(text, terms) {
  text = text || "";
  return terms.some((term) => text.includes(term));
}

function safeInt(value) {
  const parsed = parseInt(value || "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rankFromScore(track, score) {
  if (!score || !DATA) return 0;
  const row = DATA.scoreSegments.find((item) => item.track === track && Number(item.score) === Number(score));
  return row ? Number(row.cumulative_count) : 0;
}

function classifyTier(candidateRank, minRank) {
  const ratio = (minRank - candidateRank) / Math.max(candidateRank, 1);
  if (ratio >= -0.08 && ratio < 0) return "冲";
  if (ratio >= 0 && ratio <= 0.18) return "稳";
  if (ratio > 0.18 && ratio <= 0.45) return "保";
  if (ratio > 0.45 && ratio <= 0.8) return "兜底";
  return "";
}

function isSpecialProgram(text) {
  return containsAny(text, ["国家专项", "高校专项", "地方专项", "少数民族", "民族班", "预科", "艺术", "体育", "提前批"]);
}

function isJointProgram(text) {
  return (text || "").includes("中外合作") || (text || "").includes("合作办学");
}

function compactMajor(value) {
  const text = value || "";
  if (text.includes("专业组最低线")) return "专业组线";
  if (text.startsWith("学校最低线")) return "学校最低线";
  return text;
}

function makeOrderId() {
  const suffix = Math.abs(hashCode([
    $("track").value,
    $("score").value,
    $("rank").value,
    $("customerName").value,
    $("customerPhone").value,
    Date.now().toString().slice(0, -4)
  ].join("|"))) % 10000;
  return "SC260624-" + suffix.toString().padStart(4, "0");
}

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function recommend() {
  if (!DATA) return;
  const track = $("track").value;
  const score = safeInt($("score").value);
  const rank = safeInt($("rank").value) || rankFromScore(track, score);
  if (!rank) {
    LAST_RESULTS = [];
    renderResults([]);
    $("notice").textContent = "请输入位次；如果只填分数，需要该分数能在一分一段表中匹配到位次。";
    $("downloadBtn").disabled = true;
    return;
  }

  const preferredCities = splitTerms($("preferredCities").value);
  const avoidedCities = splitTerms($("avoidedCities").value);
  const preferredMajors = splitTerms($("preferredMajors").value);
  const avoidedMajors = splitTerms($("avoidedMajors").value);
  const acceptJoint = $("acceptJoint").value === "1";

  const results = [];
  for (const row of DATA.admissions) {
    if (row.track !== track || !row.min_rank) continue;
    const programText = [row.batch, row.major_name, row.group_code].filter(Boolean).join(" ");
    if (isSpecialProgram(programText)) continue;
    if (!acceptJoint && isJointProgram(programText)) continue;
    if (avoidedCities.length && containsAny(row.city, avoidedCities)) continue;
    if (avoidedMajors.length && containsAny(programText, avoidedMajors)) continue;

    const tier = classifyTier(rank, Number(row.min_rank));
    if (!tier) continue;

    const delta = Number(row.min_rank) - rank;
    let sort = delta;
    const reasons = [`2025最低位次 ${row.min_rank}，考生位次 ${rank}，差值 ${delta}`];
    if (preferredCities.length && containsAny(row.city, preferredCities)) {
      sort -= rank * 0.03;
      reasons.push("城市偏好匹配");
    }
    if (preferredMajors.length && containsAny(programText, preferredMajors)) {
      sort -= rank * 0.05;
      reasons.push("专业偏好匹配");
    }
    if ((row.batch || "").includes("过渡数据") || (row.batch || "").includes("聚合")) {
      reasons.push("待人工复核");
    }
    results.push({
      tier,
      school: row.school_name,
      city: row.city || "",
      major: row.major_name || "",
      group: row.group_code || "",
      batch: row.batch || "",
      score: row.min_score || "",
      rank: row.min_rank,
      delta,
      reason: reasons.join("；"),
      sort
    });
  }

  const order = { "冲": 1, "稳": 2, "保": 3, "兜底": 4 };
  results.sort((a, b) => (order[a.tier] - order[b.tier]) || (a.sort - b.sort));
  LAST_RESULTS = results.slice(0, 200);
  LAST_ORDER_ID = makeOrderId();
  $("orderId").textContent = `订单号：${LAST_ORDER_ID}`;
  $("notice").textContent = `共 ${LAST_RESULTS.length} 条候选。页面免费展示全部结果；下载完整 CSV 作为 9.9 表格交付。本表不能直接照填，最终需复核院校代码、专业组代码、专业代码和招生计划。`;
  $("downloadBtn").disabled = LAST_RESULTS.length === 0;
  renderResults(LAST_RESULTS);
}

function renderResults(rows) {
  const body = $("resultBody");
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.tier)}</td>
      <td>${escapeHtml(r.school)}</td>
      <td>${escapeHtml(r.city)}</td>
      <td class="clip" title="${escapeHtml(r.major)}">${escapeHtml(compactMajor(r.major))}</td>
      <td>${escapeHtml(r.group)}</td>
      <td>${escapeHtml(r.score)}</td>
      <td>${escapeHtml(r.rank)}</td>
      <td>${escapeHtml(r.delta)}</td>
      <td class="clip" title="${escapeHtml(r.reason)}">${escapeHtml(r.reason.replace("待人工复核", "待复核"))}</td>
    </tr>
  `).join("");
  $("empty").style.display = rows.length ? "none" : "block";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

function downloadCsv() {
  if (!LAST_RESULTS.length) return;
  const rank = safeInt($("rank").value) || rankFromScore($("track").value, safeInt($("score").value));
  const rows = [
    ["四川高考志愿初筛表"],
    ["订单号", LAST_ORDER_ID],
    ["客户姓名", $("customerName").value],
    ["联系方式", $("customerPhone").value],
    ["科类", $("track").value],
    ["分数", $("score").value],
    ["位次", rank],
    ["偏好城市", $("preferredCities").value],
    ["偏好专业", $("preferredMajors").value],
    [],
    ["层级", "学校", "城市", "专业/说明", "专业组", "批次", "最低分", "最低位次", "位次差", "推荐理由"],
    ...LAST_RESULTS.map((r) => [r.tier, r.school, r.city, r.major, r.group, r.batch, r.score, r.rank, r.delta, r.reason]),
    [],
    ["重要提示", "本表为志愿咨询初筛结果，不等于录取承诺，也不能直接作为最终填报表。正式方案必须人工复核院校代码、专业组代码、专业代码、招生计划、选科要求、体检限制、语种要求、校区、学费、中外合作和专业组内调剂风险。"],
    ["升级服务", "如需进一步判断学校/专业/代码/计划数/校区/学费/就业/读研/宿舍等信息，可做 99 元深度资料整理和人工复核。"]
  ];
  const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${LAST_ORDER_ID}_gaokao_recommendations.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function setupPaymentLinks() {
  const config = window.GAOKAO_CONFIG || {};
  const pay9 = $("pay9Btn");
  const pay99 = $("pay99Btn");
  if (pay9) pay9.href = config.payment9Url || "#";
  if (pay99) pay99.href = config.payment99Url || "deep-request.html";
}

function copyConsultTemplate() {
  const rank = safeInt($("rank").value) || rankFromScore($("track").value, safeInt($("score").value)) || "";
  const config = window.GAOKAO_CONFIG || {};
  const text = [
    "【志愿咨询】",
    `科类：${$("track").value}`,
    `分数：${$("score").value}`,
    `位次：${rank}`,
    `偏好城市：${$("preferredCities").value}`,
    `偏好专业：${$("preferredMajors").value}`,
    `是否接受中外合作：${$("acceptJoint").value === "1" ? "可接受" : "不接受"}`,
    "想咨询的问题：",
    "",
    "已付款项目：9.9导出表格 / 99深度整理",
    "虎皮椒订单号/付款截图：",
    "",
    `联系微信：${config.wechatId || ""}`
  ].join("\n");
  navigator.clipboard?.writeText(text);
  $("notice").textContent = "咨询模板已生成，可粘贴给咨询老师；如浏览器未自动复制，请手动复制页面信息。";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();
  $("meta").textContent = `${DATA.meta.schoolCount} 所学校，${DATA.meta.admissionCount} 条线位`;
  $("runBtn").addEventListener("click", recommend);
  $("downloadBtn").addEventListener("click", downloadCsv);
  $("copyConsultBtn").addEventListener("click", copyConsultTemplate);
  setupPaymentLinks();
  const params = new URLSearchParams(location.search);
  for (const [key, id] of [
    ["track", "track"], ["score", "score"], ["rank", "rank"],
    ["preferred_cities", "preferredCities"], ["avoided_cities", "avoidedCities"],
    ["preferred_majors", "preferredMajors"], ["avoided_majors", "avoidedMajors"],
    ["accept_joint", "acceptJoint"]
  ]) {
    if (params.has(key)) $(id).value = params.get(key);
  }
  if (params.has("submitted")) recommend();
}

init().catch((error) => {
  $("meta").textContent = "数据加载失败";
  $("notice").textContent = error.message;
});
