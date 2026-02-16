const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("active tab not found");
  return tab;
}

async function ensurePermissionsForSave(options) {
  const tab = await getActiveTab();
  const tabUrl = tab.url || "";
  if (!/^https?:\/\//.test(tabUrl)) {
    throw new Error("http/httpsページでのみ動作します (chrome:// や file:// は対象外)");
  }

  // IMPORTANT: permissions.request must be called during a user gesture.
  // Avoid any extra async work (like executeScript) before requesting.
  const origins = buildRequiredOrigins(tabUrl, options);
  const req = {};
  if (origins.length) req.origins = origins;
  const perms = [];
  if (options.includeCookies) perms.push("cookies");
  if (perms.length) req.permissions = perms;

  if (!req.origins && !req.permissions) {
    return { tab, pageUrl: tabUrl };
  }

  const has = await chrome.permissions.contains(req);
  if (!has) {
    const granted = await chrome.permissions.request(req);
    if (!granted) throw new Error("必要な権限が許可されませんでした");
  }

  return { tab, pageUrl: tabUrl };
}

async function sendSave() {
  setStatus("処理中... 初期化しています");
  $("saveBtn").disabled = true;
  try {
    const options = {
      includeResources: $("includeResources").checked,
      includeNetworkLog: $("includeNetworkLog").checked,
      includeHar: $("includeHar").checked,
      useDebuggerCapture: $("useDebuggerCapture").checked,
      sameOriginOnly: $("sameOriginOnly").checked,
      includeCookies: $("includeCookies").checked,
      includeStorage: $("includeStorage").checked
    };

    // IMPORTANT: permissions.request must be called during a user gesture.
    setStatus("処理中... 権限を確認しています");
    await ensurePermissionsForSave(options);

    setStatus("処理中... ページ情報とネットワーク情報を保存しています");
    const res = await chrome.runtime.sendMessage({ type: "SAVE_CURRENT_TAB", options });
    if (!res?.ok) throw new Error(res?.error || "unknown error");
    const warn = Array.isArray(res.warnings) && res.warnings.length ? `\n警告: ${res.warnings.join(" | ")}` : "";
    setStatus(
      `完了しました。\n保存先: Downloads/${res.folder}\n対象URL: ${res.url}\nリソース数: ${res.resourceCount}${warn}`
    );
  } catch (e) {
    setStatus(String(e?.message || e), true);
  } finally {
    $("saveBtn").disabled = false;
  }
}

async function openDownloads() {
  try {
    await chrome.runtime.sendMessage({ type: "OPEN_DOWNLOADS" });
  } catch {
    // ignore
  }
}

function syncHarDependentOptions() {
  const har = $("includeHar");
  const dbg = $("useDebuggerCapture");
  if (!har || !dbg) return;
  dbg.disabled = !har.checked;
  if (!har.checked) dbg.checked = false;
}

$("saveBtn").addEventListener("click", sendSave);
$("openDownloadsBtn").addEventListener("click", openDownloads);
$("includeHar").addEventListener("change", syncHarDependentOptions);
syncHarDependentOptions();
