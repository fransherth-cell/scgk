let DATA = null;
let ART_DATA = null;
let LAST_RESULTS = [];
let LAST_ORDER_ID = "";

const $ = (id) => document.getElementById(id);
const SHARE_TEXT = "四川高考志愿初筛工具 — 输入分数与选科，基于2025年录取位次数据，5秒生成冲稳保清单 → scgk114.com";

function splitTerms(value) {
  return (value || "").replace(/[，、；;]/g, ",").split(",").map((item) => item.trim()).filter(Boolean);
}

function containsAny(text, terms) {
  const value = text || "";
  return terms.some((term) => value.includes(term));
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
  return containsAny(text, ["中外合作", "合作办学"]);
}

function compactMajor(value) {
  const text = value || "";
  if (text.includes("专业组最低线")) return "专业组线";
  if (text.startsWith("学校最低线")) return "学校最低线";
  return text;
}

function makeOrderId() {
  return `SC${Date.now()}`;
}

function setExportState() {
  if ($("exportBtn")) $("exportBtn").disabled = LAST_RESULTS.length === 0;
}

function recommend() {
  if (!DATA) return;
  if ($("queryType")?.value === "art") {
    recommendArt();
    return;
  }

  const track = $("track").value;
  const score = safeInt($("score").value);
  const rank = safeInt($("rank").value) || rankFromScore(track, score);

  if (!rank) {
    LAST_RESULTS = [];
    renderResults([]);
    $("notice").textContent = "请输入位次；如果只填分数，需要该分数能在一分一段表中匹配到位次。";
    setExportState();
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
    const reasons = [`2025最低位次${row.min_rank}，考生位次${rank}，差值${delta}`];

    if (preferredCities.length && containsAny(row.city, preferredCities)) {
      sort -= rank * 0.03;
      reasons.push("城市偏好匹配");
    }
    if (preferredMajors.length && containsAny(programText, preferredMajors)) {
      sort -= rank * 0.05;
      reasons.push("专业偏好匹配");
    }
    if ((row.batch || "").includes("过渡数据") || (row.batch || "").includes("聚合")) {
      reasons.push("需人工复核");
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
  $("orderId").textContent = `查询号：${LAST_ORDER_ID}`;
  $("notice").textContent = `共 ${LAST_RESULTS.length} 条候选。页面可免费浏览，也可以保存为 Excel 表格。正式填报前仍需复核院校代码、专业组代码、专业代码和招生计划。`;
  addLowScoreNotice(track, score);
  setExportState();
  renderResults(LAST_RESULTS);
}

function addLowScoreNotice(track, score) {
  if (!score) return;
  const lowPhysical = track === "物理类" && score < 438;
  const edgePhysical = track === "物理类" && score >= 410 && score <= 440;
  const lowHistory = track === "历史类" && score < 467;
  if (!lowPhysical && !edgePhysical && !lowHistory) return;

  const base = $("notice").textContent;
  if (lowHistory) {
    $("notice").textContent = `${base} 当前分数低于2025历史类本科控制线467分，普通本科可选范围非常窄，建议重点关注高职专科批、民办本科征集志愿、艺体/专项资格以及人工复核方案。`;
  } else if (lowPhysical) {
    $("notice").textContent = `${base} 当前分数低于2025物理类本科控制线438分，普通本科可选范围较窄，建议重点关注高职专科批、民办本科征集志愿、职业本科和人工复核方案。`;
  } else if (edgePhysical) {
    $("notice").textContent = `${base} 当前处在物理类本科压线区间，建议重点核对民办本科、职业本科、中外合作、征集志愿和专科保底方案。`;
  }
}

function setMode() {
  const isArt = $("queryType")?.value === "art";
  document.body.classList.toggle("art-mode", isArt);
  $("score").placeholder = isArt ? "请输入文化分" : "请输入分数";
  $("notice").textContent = isArt
    ? "艺体类需同时参考文化分、专业分、综合成绩/专业成绩位次和当年招生计划。本模块先做川内方向初筛。"
    : "本工具用于志愿初筛，不等于录取承诺，也不能直接作为最终填报表。正式填报前必须复核院校代码、专业组代码、专业代码、招生计划、选科、体检、语种、校区、学费和调剂风险。";
  LAST_RESULTS = [];
  renderResults([]);
  setExportState();
}

function populateArtCategories() {
  if (!ART_DATA || !$("artCategory")) return;
  $("artCategory").innerHTML = ART_DATA.categories.map((item) => `<option>${escapeHtml(item.name)}</option>`).join("");
}

function recommendArt() {
  if (!ART_DATA) return;
  const categoryName = $("artCategory").value;
  const culture = safeInt($("score").value);
  const major = safeInt($("majorScore").value);
  const category = ART_DATA.categories.find((item) => item.name === categoryName);

  if (!category || !culture || !major) {
    LAST_RESULTS = [];
    renderResults([]);
    $("notice").textContent = "艺体类请填写类别、文化分和专业分。";
    setExportState();
    return;
  }

  const passUnder = culture >= category.underCulture && major >= category.underMajor;
  const passJunior = culture >= category.juniorCulture && major >= category.juniorMajor;
  const cultureDelta = culture - category.underCulture;
  const majorDelta = major - category.underMajor;
  const preferredCities = splitTerms($("preferredCities").value);
  const avoidedCities = splitTerms($("avoidedCities").value);
  const preferredMajors = splitTerms($("preferredMajors").value);
  let tier = "需谨慎";
  if (passUnder) tier = "本科线以上";
  else if (passJunior) tier = "专科线以上";

  const schools = ART_DATA.schools.filter((school) => {
    if (!school.categories.includes(categoryName)) return false;
    if (avoidedCities.length && containsAny(school.city, avoidedCities)) return false;
    if (preferredCities.length && !containsAny(school.city, preferredCities)) return false;
    if (preferredMajors.length && !containsAny(`${school.categories.join(" ")} ${school.focus}`, preferredMajors)) return false;
    return true;
  });

  LAST_RESULTS = schools.map((school) => ({
    tier,
    school: school.school,
    city: school.city,
    major: categoryName,
    group: "艺体",
    batch: "艺体类本科/专科需复核",
    score: culture,
    rank: $("artRank").value || "待填",
    delta: passUnder ? `文化+${cultureDelta}/专业+${majorDelta}` : `文化${cultureDelta}/专业${majorDelta}`,
    reason: `${school.focus}；本科线：文化${category.underCulture}、专业${category.underMajor}，当前差值：文化${cultureDelta >= 0 ? "+" : ""}${cultureDelta}、专业${majorDelta >= 0 ? "+" : ""}${majorDelta}。`
  }));

  LAST_ORDER_ID = makeOrderId();
  $("orderId").textContent = `查询号：${LAST_ORDER_ID}`;
  $("notice").textContent = `艺体类 ${categoryName}：文化${culture}，专业${major}。本科线为文化${category.underCulture}/专业${category.underMajor}，当前${passUnder ? "已过本科控制线" : passJunior ? "已过专科控制线，本科方向需谨慎" : "控制线未满足或需复核"}。`;
  setExportState();
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
      <td class="clip" title="${escapeHtml(r.reason)}">${escapeHtml(r.reason)}</td>
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

function copyMyInfo() {
  const isArt = $("queryType")?.value === "art";
  const rank = isArt ? ($("artRank").value || "") : (safeInt($("rank").value) || rankFromScore($("track").value, safeInt($("score").value)) || "");
  const text = [
    "【我的志愿需求】",
    `查询类型：${isArt ? "艺体类" : "普通类"}`,
    `科类/类别：${isArt ? $("artCategory").value : $("track").value}`,
    `${isArt ? "文化分" : "分数"}：${$("score").value}`,
    `${isArt ? "专业分" : "位次"}：${isArt ? $("majorScore").value : rank}`,
    `偏好城市：${$("preferredCities").value}`,
    `回避城市：${$("avoidedCities").value}`,
    `偏好专业：${$("preferredMajors").value}`,
    `回避专业：${$("avoidedMajors").value}`,
    `是否接受中外合作：${$("acceptJoint") ? ($("acceptJoint").value === "1" ? "可接受" : "不接受") : ""}`
  ].join("\n");
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    $("notice").textContent = "志愿需求已复制，添加微信后可直接发送。";
  } else {
    $("notice").textContent = text;
  }
}

function buildWorkbookRows() {
  const isArt = $("queryType")?.value === "art";
  const rank = isArt ? ($("artRank").value || "") : (safeInt($("rank").value) || rankFromScore($("track").value, safeInt($("score").value)));
  const infoRows = [
    ["查询号", LAST_ORDER_ID],
    ["查询类型", isArt ? "艺体类" : "普通类"],
    ["科类/类别", isArt ? $("artCategory").value : $("track").value],
    [isArt ? "文化分" : "分数", $("score").value],
    [isArt ? "专业分" : "位次", isArt ? $("majorScore").value : rank],
    ["偏好城市", $("preferredCities").value],
    ["偏好专业", $("preferredMajors").value]
  ];
  const header = ["层级", "学校", "城市", "专业/说明", "专业组", "批次", "最低分", "最低位次", "位次差", "推荐理由"];
  const rows = LAST_RESULTS.map((r) => [r.tier, r.school, r.city, r.major, r.group, r.batch, r.score, r.rank, r.delta, r.reason]);
  return [
    ["四川高考志愿初筛表"],
    ...infoRows,
    [],
    header,
    ...rows,
    [],
    ["重要提示", "本表为志愿初筛结果，不等于录取承诺，也不能直接作为最终填报表。正式填报前必须复核院校代码、专业组代码、专业代码、招生计划、选科、体检、语种、校区、学费和调剂风险。"]
  ];
}

function downloadExcel() {
  if (!LAST_RESULTS.length) return;
  if (!window.XLSX) {
    alert("导出组件加载失败，请刷新页面后再试。");
    return;
  }
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(buildWorkbookRows());
  worksheet["!cols"] = [
    { wch: 10 }, { wch: 20 }, { wch: 12 }, { wch: 42 }, { wch: 12 },
    { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 60 }
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "志愿初筛");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${LAST_ORDER_ID || "gaokao"}_recommendations.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function shareAndDownloadExcel() {
  if (!LAST_RESULTS.length) {
    $("notice").textContent = "请先生成初筛表，再保存表格。";
    return;
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(SHARE_TEXT);
  }
  const btn = $("exportBtn");
  btn.textContent = "✅ 已复制，表格下载中…";
  showToast("✅ 已复制推荐语，转发给身边也在填志愿的家长吧");
  downloadExcel();
  window.setTimeout(() => {
    btn.textContent = "📥 分享并下载 Excel 表格";
  }, 2000);
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 5000);
}

function copyWechat() {
  const config = window.GAOKAO_CONFIG || {};
  const value = config.wechatId || "franzxeth";
  if (navigator.clipboard) {
    navigator.clipboard.writeText(value);
    $("notice").textContent = `微信联系方式已复制：${value}`;
  } else {
    $("notice").textContent = `微信联系方式：${value}`;
  }
}

async function init() {
  const response = await fetch("data.json");
  DATA = await response.json();
  try {
    const artResponse = await fetch("art_data.json");
    ART_DATA = await artResponse.json();
    populateArtCategories();
  } catch (_) {
    ART_DATA = null;
  }

  const config = window.GAOKAO_CONFIG || {};
  $("meta").textContent = `${DATA.meta.schoolCount} 所普通类学校，${DATA.meta.admissionCount} 条线位${ART_DATA ? `；艺体类 ${ART_DATA.schools.length} 所川内关注院校` : ""}`;
  if ($("wechatText")) $("wechatText").textContent = config.wechatId || "franzxeth";
  $("queryType").addEventListener("change", setMode);
  $("runBtn").addEventListener("click", recommend);
  $("exportBtn").addEventListener("click", shareAndDownloadExcel);
  $("copyInfoBtn").addEventListener("click", copyMyInfo);
  if ($("copyWechatBtn")) $("copyWechatBtn").addEventListener("click", copyWechat);

  const params = new URLSearchParams(location.search);
  for (const [key, id] of [
    ["track", "track"],
    ["score", "score"],
    ["rank", "rank"],
    ["preferred_cities", "preferredCities"],
    ["avoided_cities", "avoidedCities"],
    ["preferred_majors", "preferredMajors"],
    ["avoided_majors", "avoidedMajors"],
    ["accept_joint", "acceptJoint"],
    ["query_type", "queryType"],
    ["art_category", "artCategory"]
  ]) {
    if (params.has(key) && $(id)) $(id).value = params.get(key);
  }
  setMode();
  if (params.has("submitted")) recommend();
}

init().catch((error) => {
  $("meta").textContent = "数据加载失败";
  $("notice").textContent = error.message;
});
