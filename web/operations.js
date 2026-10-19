const tokenInput = document.getElementById("token");
const message = document.getElementById("message");
let dashboardToken = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
function showMessage(text, type) { message.textContent = text; message.className = `status ${type || ""}`; }
function formatDate(value) { return value ? new Date(value).toLocaleString() : "-"; }
function confirmAction(label) { return window.confirm(`${label}\n\nThis action changes the local scheduler or queue.`); }
function getToken() {
  if (!dashboardToken) {
    dashboardToken = tokenInput.value.trim() || window.prompt("Enter DASHBOARD_TOKEN:") || "";
    tokenInput.value = dashboardToken;
  }
  return dashboardToken;
}
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}), "X-Dashboard-Token": getToken() };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
async function post(url, body, label) {
  if (!confirmAction(label)) return;
  const data = await api(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ ...body, confirm:true }) });
  showMessage("Action completed.", "good");
  await refresh();
  return data;
}
function platformButtons(accountId, platform, running) {
  return `<span class="pill ${running ? "good-text" : "warn-text"}">${running ? "Running" : "Paused"}</span>
    <button data-action="pause" data-account="${escapeHtml(accountId)}" data-platform="${platform}" class="danger">Pause</button>
    <button data-action="resume" data-account="${escapeHtml(accountId)}" data-platform="${platform}" class="good">Resume</button>
    <button data-action="tick" data-account="${escapeHtml(accountId)}" data-platform="${platform}" class="primary">Tick</button>`;
}
function renderQueues(data) {
  const accounts = data.accounts || {};
  const rows = [];
  for (const [accountId, account] of Object.entries(accounts)) {
    for (const [platform, state] of Object.entries(account.platforms || {})) {
      const quota = state.quota || {};
      const errors = (state.recentErrors || []).map((item) => `<div class="small bad-text">${escapeHtml(item.motivo)}${item.fileName ? ` <button data-action="requeue" data-account="${escapeHtml(accountId)}" data-platform="${platform}" data-file-name="${escapeHtml(item.fileName)}">Requeue</button>` : ""}</div>`).join("") || "-";
      const pending = (state.pendingFiles || []).length ? state.pendingFiles.map((file) => `<span class="pill">${escapeHtml(file)}</span>`).join("") : "-";
      rows.push(`<tr>
        <td><strong>${escapeHtml(account.name || accountId)}</strong><br><span class="muted small">${escapeHtml(platform)}</span></td>
        <td>${state.counts?.pending || 0} / ${state.counts?.posted || 0} / ${state.counts?.failed || 0}<div class="small muted">pending / posted / failed</div></td>
        <td>${quota.count || 0} / ${quota.cap ?? "-"}<div class="small muted">quota used / cap</div></td>
        <td>${escapeHtml(formatDate(state.nextScheduledAt))}<div class="small">${pending}</div></td>
        <td>${escapeHtml(formatDate(state.lastPublication?.at))}<div class="small">${escapeHtml(state.lastPublication?.fileName || "-")}</div></td>
        <td>${errors}</td>
        <td class="nowrap">${platformButtons(accountId, platform, state.scheduler?.running)}</td>
      </tr>`);
    }
  }
  document.getElementById("queueTable").innerHTML = rows.length ? `<table><thead><tr><th>Account / platform</th><th>Queues</th><th>Quota</th><th>Next scheduled</th><th>Last publication</th><th>Recent errors</th><th>Actions</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="empty">No accounts or queues detected.</div>`;
}
function renderHealth(data) {
  const rows = [];
  for (const [accountId, account] of Object.entries(data.accounts || {})) {
    for (const [platform, health] of Object.entries(account.platforms || {})) {
      const suspicious = health.suspiciousExpiration;
      rows.push(`<tr><td>${escapeHtml(account.name || accountId)}</td><td>${escapeHtml(platform)}</td><td>${health.profileExists ? "OK" : "NO"}</td><td>${health.cookiesPresent ? "OK" : "NO"}</td><td>${escapeHtml(formatDate(health.lastProfileUse))}</td><td class="${suspicious ? "warn-text" : "good-text"}">${suspicious ? "Suspicious expiration" : (health.cookiesLikelyValid ? "Heuristic healthy" : "Needs manual login check")}</td></tr>`);
    }
  }
  document.getElementById("healthTable").innerHTML = rows.length ? `<table><thead><tr><th>Account</th><th>Platform</th><th>Profile</th><th>Cookies</th><th>Last profile use</th><th>Result</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : `<div class="empty">No sessions detected.</div>`;
}
async function refresh() {
  try {
    const [status, health] = await Promise.all([api("/api/status"), api("/api/sessions/health")]);
    renderQueues(status.operations || { accounts: status.accounts });
    renderHealth(health);
    if (!message.textContent) showMessage(`Updated ${new Date().toLocaleTimeString()}.`);
  } catch (error) { showMessage(error.message, "error"); }
}
document.getElementById("saveToken").onclick = () => { dashboardToken = tokenInput.value.trim(); showMessage("Token kept in this session only.", "good"); };
document.getElementById("refresh").onclick = refresh;
document.getElementById("pauseAll").onclick = () => post("/api/operations/scheduler/pause", {}, "Pause all schedulers?");
document.getElementById("resumeAll").onclick = () => post("/api/operations/scheduler/resume", {}, "Resume all schedulers?");
document.getElementById("tickAll").onclick = () => post("/api/operations/tick", {}, "Force a tick on all schedulers?");
document.getElementById("queueTable").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, account, platform } = button.dataset;
  if (action === "requeue") {
    post("/api/operations/requeue", { accountId: account, platform, fileName: button.dataset.fileName }, `Requeue ${button.dataset.fileName} for ${account}?`);
    return;
  }
  const url = action === "tick" ? "/api/operations/tick" : `/api/operations/scheduler/${action}`;
  post(url, { accountId: account, platform }, `${action} ${platform} for ${account}?`);
});
refresh();
