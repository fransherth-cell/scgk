(() => {
  const API_ROOT = "/api/image";
  const form = document.querySelector("#generate-form");
  const prompt = document.querySelector("#prompt");
  const size = document.querySelector("#size");
  const quality = document.querySelector("#quality");
  const count = document.querySelector("#count");
  const generate = document.querySelector("#generate");
  const status = document.querySelector("#status");
  const results = document.querySelector("#results");
  const characterCount = document.querySelector("#character-count");
  const historyCount = document.querySelector("#history-count");
  const previewDialog = document.querySelector("#preview-dialog");
  const previewImage = document.querySelector("#preview-image");
  const previewDownload = document.querySelector("#preview-download");

  const state = { images: [], polling: false };
  const ideas = [
    "一座漂浮在云层上的未来图书馆，玻璃穹顶，清晨柔光，电影级构图",
    "极简科研信息图：光电效应实验原理，白色背景，蓝绿色点缀，中文标注空间",
    "一只戴宇航头盔的橘猫站在月球表面，远处是地球，电影级光影，细节清晰",
    "雨后的城市夜景，玻璃橱窗倒映霓虹，低机位，胶片质感，人物剪影"
  ];

  function getVisitorId() {
    const key = "scgk-image-visitor";
    let value = sessionStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID().replaceAll("-", "");
      sessionStorage.setItem(key, value);
    }
    return value;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-SCGK-Visitor": getVisitorId(),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      throw new Error(data?.error?.message || "生成暂时未完成，请调整描述后重试。");
    }
    return data;
  }

  function setBusy(busy, message) {
    state.polling = busy;
    generate.disabled = busy;
    generate.querySelector("span:last-child").textContent = busy ? "生成中" : "开始生成";
    if (message) status.textContent = message;
  }

  function setStatus(message, type = "") {
    status.className = `status ${type}`.trim();
    status.textContent = message;
  }

  function updateHistoryCount() {
    historyCount.textContent = `${state.images.length} 张`;
  }

  function drawResults() {
    if (!state.images.length) {
      results.innerHTML = `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✦</div><h3>等待第一张作品</h3><p>填写描述并开始生成，完成的图片会保留在本次会话中。</p></div>`;
      updateHistoryCount();
      return;
    }
    results.innerHTML = state.images.map((image, index) => `
      <article class="result-card">
        <button class="image-button" type="button" data-preview="${index}" aria-label="预览第 ${index + 1} 张图片"><img src="${image.url}" alt="本次生成的第 ${index + 1} 张图片" /></button>
        <div class="result-actions"><span>作品 ${index + 1}</span><a href="${image.downloadUrl}" download>下载</a></div>
      </article>`).join("");
    results.querySelectorAll("[data-preview]").forEach((button) => {
      button.addEventListener("click", () => openPreview(state.images[Number(button.dataset.preview)]));
    });
    updateHistoryCount();
  }

  function openPreview(image) {
    previewImage.src = image.url;
    previewDownload.href = image.downloadUrl;
    previewDialog.showModal();
  }

  async function waitForTask(taskId) {
    for (;;) {
      const task = await request(`/tasks/${taskId}`, { method: "GET" });
      if (task.status === "completed") return task;
      if (task.status === "failed") throw new Error(task.message || "生成暂时未完成，请调整描述后重试。");
      const queue = task.status === "queued" && task.queuePosition ? `当前生成任务较多，已进入队列，前方约 ${task.queuePosition} 个任务。` : "图片正在生成，请稍候。";
      setStatus(queue);
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  }

  prompt.addEventListener("input", () => {
    characterCount.textContent = `${prompt.value.length} / 2000`;
  });

  document.querySelector("#surprise").addEventListener("click", () => {
    prompt.value = ideas[Math.floor(Math.random() * ideas.length)];
    prompt.dispatchEvent(new Event("input"));
    prompt.focus();
  });

  document.querySelector("#clear-history").addEventListener("click", () => {
    if (state.polling) return;
    state.images = [];
    drawResults();
    setStatus("本次会话记录已清空。");
  });

  previewDialog.querySelector(".close-preview").addEventListener("click", () => previewDialog.close());
  previewDialog.addEventListener("click", (event) => { if (event.target === previewDialog) previewDialog.close(); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const description = prompt.value.trim();
    if (description.length < 3) return setStatus("请先写下至少 3 个字符的图片描述。", "error");
    if (state.polling) return;
    setBusy(true, "正在提交生成任务。");
    try {
      const task = await request("/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: description, size: size.value, quality: quality.value, n: Number(count.value) })
      });
      const completed = task.status === "completed" ? task : await waitForTask(task.taskId);
      state.images = [...completed.images, ...state.images];
      drawResults();
      setStatus("生成完成，点击图片可预览，或直接下载。", "success");
    } catch (error) {
      setStatus(error.message || "生成暂时未完成，请调整描述后重试。", "error");
    } finally {
      setBusy(false);
    }
  });

  drawResults();
})();
