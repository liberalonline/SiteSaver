importScripts("shared.js");

// ILLEGAL_PATH_RE, sanitizePathComponent, filenameForResource は shared.js で定義

function pad2(n) {
  return String(n).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTimestampForPath(ts) {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

// sanitizePathComponent は shared.js で定義


function toJsonPretty(x) {
  return JSON.stringify(x, null, 2) + "\n";
}

function headersObjectToArray(headersObj) {
  if (!headersObj || typeof headersObj !== "object") return [];
  const out = [];
  for (const [name, raw] of Object.entries(headersObj)) {
    if (raw == null) continue;
    if (Array.isArray(raw)) {
      out.push({ name, value: raw.map((v) => String(v)).join("\n") });
    } else {
      out.push({ name, value: String(raw) });
    }
  }
  return out;
}

function getHeaderCaseInsensitive(headersObj, targetName) {
  if (!headersObj || typeof headersObj !== "object") return "";
  const t = String(targetName || "").toLowerCase();
  for (const [k, v] of Object.entries(headersObj)) {
    if (String(k).toLowerCase() === t) return String(v ?? "");
  }
  return "";
}

function parseQueryString(url) {
  try {
    const u = new URL(url);
    const out = [];
    u.searchParams.forEach((value, name) => out.push({ name, value }));
    return out;
  } catch {
    return [];
  }
}

function extractHttpVersion(rec) {
  const p = String(rec.protocol || "").toLowerCase();
  if (!p) return "";
  if (p === "h2" || p === "http/2") return "HTTP/2";
  if (p === "http/1.1") return "HTTP/1.1";
  if (p === "http/1.0") return "HTTP/1.0";
  return p.toUpperCase();
}

function diffTiming(start, end) {
  if (typeof start !== "number" || typeof end !== "number") return -1;
  if (start < 0 || end < 0) return -1;
  if (end < start) return -1;
  return end - start;
}

function isLikelyTextMime(mime) {
  const m = String(mime || "").toLowerCase();
  return (
    m.startsWith("text/") ||
    m.includes("json") ||
    m.includes("javascript") ||
    m.includes("xml") ||
    m.includes("x-www-form-urlencoded") ||
    m.includes("graphql")
  );
}

function shouldCaptureBody(rec, maxBodyBytes) {
  if (!rec) return false;
  const method = String(rec.method || "GET").toUpperCase();
  if (method === "HEAD") return false;
  if (rec.status >= 300 && rec.status < 400) return false;

  const est = Number(rec.encodedDataLength || 0);
  if (est > 0 && est > maxBodyBytes) return false;

  const type = String(rec.resourceType || "");
  const mime = String(rec.mimeType || "");
  if (isLikelyTextMime(mime)) return true;
  if (["XHR", "Fetch", "Document", "Script", "Stylesheet"].includes(type)) return true;
  return false;
}

function buildHarEntry(rec, ctx) {
  if (!rec || rec.skip) return null;

  const startIso = rec.wallTime
    ? new Date(rec.wallTime * 1000).toISOString()
    : new Date(
      ctx.captureStartMs +
      (typeof rec.startTs === "number" && typeof ctx.firstTs === "number"
        ? (rec.startTs - ctx.firstTs) * 1000
        : 0)
    ).toISOString();

  const totalMs =
    typeof rec.startTs === "number" && typeof rec.endTs === "number"
      ? Math.max(0, (rec.endTs - rec.startTs) * 1000)
      : -1;

  const timing = rec.responseTiming || null;
  const dns = timing ? diffTiming(timing.dnsStart, timing.dnsEnd) : -1;
  const connect = timing ? diffTiming(timing.connectStart, timing.connectEnd) : -1;
  const ssl = timing ? diffTiming(timing.sslStart, timing.sslEnd) : -1;
  const send = timing ? diffTiming(timing.sendStart, timing.sendEnd) : -1;
  const wait = timing ? diffTiming(timing.sendEnd, timing.receiveHeadersEnd) : -1;
  let receive = -1;
  if (totalMs >= 0 && send >= 0 && wait >= 0) {
    receive = Math.max(0, totalMs - send - wait);
  }

  const requestHeaders = headersObjectToArray(rec.requestHeaders);
  const responseHeaders = headersObjectToArray(rec.responseHeaders);

  const request = {
    method: rec.method || "GET",
    url: rec.url || "",
    httpVersion: extractHttpVersion(rec),
    cookies: [],
    headers: requestHeaders,
    queryString: parseQueryString(rec.url || ""),
    headersSize: -1,
    bodySize: rec.requestBody ? new TextEncoder().encode(rec.requestBody).byteLength : 0
  };

  if (rec.requestBody) {
    request.postData = {
      mimeType: getHeaderCaseInsensitive(rec.requestHeaders, "content-type") || "text/plain",
      text: rec.requestBody
    };
  }

  const content = {
    size: Number(rec.decodedBodyLength || rec.encodedDataLength || 0),
    mimeType: rec.mimeType || ""
  };

  if (rec.bodyText != null) {
    content.text = rec.bodyText;
    if (rec.bodyEncoding) content.encoding = rec.bodyEncoding;
  }

  const response = {
    status: Number.isFinite(rec.status) ? rec.status : 0,
    statusText: rec.statusText || (rec.failed ? "FAILED" : ""),
    httpVersion: extractHttpVersion(rec),
    cookies: [],
    headers: responseHeaders,
    content,
    redirectURL: getHeaderCaseInsensitive(rec.responseHeaders, "location"),
    headersSize: -1,
    bodySize: Number.isFinite(rec.encodedDataLength) ? rec.encodedDataLength : -1
  };

  const entry = {
    pageref: "page_1",
    startedDateTime: startIso,
    time: totalMs,
    request,
    response,
    cache: {},
    timings: {
      blocked: -1,
      dns,
      connect,
      send,
      wait,
      receive,
      ssl
    }
  };

  if (rec.resourceType) entry._resourceType = rec.resourceType;
  if (rec.fromDiskCache) entry._fromDiskCache = true;
  if (rec.fromServiceWorker) entry._fromServiceWorker = true;
  if (rec.errorText) entry._errorText = rec.errorText;
  if (rec.bodyCaptureNote) entry._bodyCapture = rec.bodyCaptureNote;

  return entry;
}

function buildHarDocument({ pageData, entries, captureMeta }) {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "Site Saver",
        version: "0.2.0"
      },
      pages: [
        {
          startedDateTime: new Date(pageData.timestamp || Date.now()).toISOString(),
          id: "page_1",
          title: pageData.title || pageData.url || "",
          pageTimings: {}
        }
      ],
      entries
    },
    _capture: captureMeta || {}
  };
}

function buildHarFromPerformance(pageData) {
  const resources = Array.isArray(pageData?.network?.resources) ? pageData.network.resources : [];
  const timeOrigin = Number(pageData?.network?.timeOrigin || 0);

  const entries = resources.map((r) => {
    const startedDateTime =
      timeOrigin > 0 && typeof r.startTime === "number"
        ? new Date(timeOrigin + r.startTime).toISOString()
        : new Date(pageData.timestamp || Date.now()).toISOString();

    return {
      pageref: "page_1",
      startedDateTime,
      time: Number(r.duration || 0),
      request: {
        method: "GET",
        url: r.name || "",
        httpVersion: "",
        cookies: [],
        headers: [],
        queryString: parseQueryString(r.name || ""),
        headersSize: -1,
        bodySize: 0
      },
      response: {
        status: Number.isFinite(r.responseStatus) ? r.responseStatus : 0,
        statusText: "",
        httpVersion: "",
        cookies: [],
        headers: [],
        content: {
          size: Number(r.encodedBodySize || 0),
          mimeType: ""
        },
        redirectURL: "",
        headersSize: -1,
        bodySize: Number(r.transferSize || 0)
      },
      cache: {},
      timings: {
        blocked: -1,
        dns:
          typeof r.domainLookupStart === "number" && typeof r.domainLookupEnd === "number"
            ? Math.max(0, r.domainLookupEnd - r.domainLookupStart)
            : -1,
        connect:
          typeof r.connectStart === "number" && typeof r.connectEnd === "number"
            ? Math.max(0, r.connectEnd - r.connectStart)
            : -1,
        send:
          typeof r.requestStart === "number" && typeof r.responseStart === "number"
            ? Math.max(0, r.responseStart - r.requestStart)
            : -1,
        wait:
          typeof r.responseStart === "number" && typeof r.responseEnd === "number"
            ? Math.max(0, r.responseEnd - r.responseStart)
            : -1,
        receive: -1,
        ssl: -1
      },
      _source: "performance"
    };
  });

  return buildHarDocument({
    pageData,
    entries,
    captureMeta: {
      mode: "performance_fallback",
      capturedAt: new Date().toISOString(),
      entryCount: entries.length
    }
  });
}

// すべての出力は OFFSCREEN_BUILD_ZIP 経由でZIP 1ファイルにまとめる

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("active tab not found");
  return tab;
}

async function assertHostPermissions(origins) {
  const required = [...new Set(Array.isArray(origins) ? origins : [])];
  if (!required.length) return { ok: true, origins: [] };

  const has = await chrome.permissions.contains({ origins: required });
  if (has) return { ok: true, origins: required };
  throw new Error("missing required host permission (request it from popup during user gesture)");
}

async function assertCookiesPermission() {
  const has = await chrome.permissions.contains({ permissions: ["cookies"] });
  if (has) return { ok: true };
  throw new Error("missing required permission: cookies (request it from popup during user gesture)");
}

async function assertDebuggerPermission() {
  const has = await chrome.permissions.contains({ permissions: ["debugger"] });
  if (has) return { ok: true };
  throw new Error("missing required permission: debugger (reload extension with updated manifest)");
}

async function execGatherPageData(tabId, options) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (opts) => (globalThis.gatherPageData ? globalThis.gatherPageData(opts) : null),
    args: [options]
  });

  if (result) return result;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
    world: "ISOLATED"
  });

  const [{ result: result2 }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: (opts) => (globalThis.gatherPageData ? globalThis.gatherPageData(opts) : null),
    args: [options]
  });

  if (!result2) throw new Error("failed to gather page data");
  return result2;
}

async function execGatherStorageData(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: () => {
      const safeDump = (storage) => {
        const out = {};
        try {
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k == null) continue;
            out[k] = storage.getItem(k);
          }
        } catch {
          // ignore
        }
        return out;
      };
      return {
        localStorage: safeDump(window.localStorage),
        sessionStorage: safeDump(window.sessionStorage)
      };
    }
  });
  return result || { localStorage: {}, sessionStorage: {} };
}

function buildLayout(pageUrl, ts) {
  const u = new URL(pageUrl);
  const host = sanitizePathComponent(u.host);
  const stamp = formatTimestampForPath(ts);

  return {
    host,
    stamp,
    zipFilename: `${host}_${stamp}.zip`,
    zipHtmlRoot: `${host}/${stamp}/html/`,
    zipDataRoot: `${host}/${stamp}/data/`
  };
}


async function ensureOffscreenDocument() {
  if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Create blob URLs for saving generated files (html/json/zip) via chrome.downloads."
  });
  await sleep(150);
}

async function maybeCloseOffscreenDocument() {
  try {
    if (chrome.offscreen?.hasDocument && (await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // ignore
  }
}

function isHttpUrlSafe(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function captureHarWithDebugger({ tab, options }) {
  const debuggee = { tabId: tab.id };
  const activeRequests = new Map();
  const harRecords = [];
  const pendingBodyTasks = new Set();

  const warnings = [];
  const captureStartMs = Date.now();
  let lastEventAt = Date.now();
  let firstTs = null;
  let attached = false;
  let timedOut = false;

  const maxCaptureMs = 25000;
  const idleMs = 1800;
  const maxBodyBytes = 1024 * 1024;
  const includeBodies = true;
  let initialOrigin = "";
  try {
    initialOrigin = new URL(tab.url || "").origin;
  } catch {
    initialOrigin = "";
  }

  function isAllowedUrl(url) {
    return isHttpUrlSafe(url);
  }

  function shouldCaptureBodyForUrl(url) {
    if (!options?.sameOriginOnly) return true;
    if (!initialOrigin) return true;
    try {
      return new URL(url).origin === initialOrigin;
    } catch {
      return false;
    }
  }

  function finalizeRecord(rec) {
    harRecords.push(rec);
  }

  function queueBodyTask(p) {
    pendingBodyTasks.add(p);
    p.finally(() => pendingBodyTasks.delete(p));
  }

  const onEvent = (source, method, params) => {
    if (source.tabId !== tab.id) return;
    lastEventAt = Date.now();

    if (typeof params?.timestamp === "number" && firstTs == null) {
      firstTs = params.timestamp;
    }

    if (method === "Network.requestWillBeSent") {
      const requestId = params.requestId;
      if (!requestId) return;

      const prev = activeRequests.get(requestId);
      if (prev && params.redirectResponse) {
        prev.endTs = params.timestamp;
        prev.status = params.redirectResponse.status;
        prev.statusText = params.redirectResponse.statusText;
        prev.responseHeaders = params.redirectResponse.headers;
        prev.mimeType = params.redirectResponse.mimeType;
        prev.protocol = params.redirectResponse.protocol;
        prev.fromDiskCache = !!params.redirectResponse.fromDiskCache;
        prev.fromServiceWorker = !!params.redirectResponse.fromServiceWorker;
        prev.encodedDataLength = Number(params.redirectResponse.encodedDataLength || 0);
        finalizeRecord(prev);
      }

      const req = params.request || {};
      const rec = {
        requestId,
        url: req.url || "",
        method: req.method || "GET",
        requestHeaders: req.headers || {},
        requestBody: typeof req.postData === "string" ? req.postData : "",
        wallTime: params.wallTime,
        startTs: params.timestamp,
        resourceType: params.type || "",
        skip: !isAllowedUrl(req.url || "")
      };
      activeRequests.set(requestId, rec);
      return;
    }

    if (method === "Network.responseReceived") {
      const requestId = params.requestId;
      if (!requestId) return;
      const rec = activeRequests.get(requestId);
      if (!rec) return;

      const res = params.response || {};
      rec.status = res.status;
      rec.statusText = res.statusText;
      rec.responseHeaders = res.headers || {};
      rec.mimeType = res.mimeType || "";
      rec.protocol = res.protocol || "";
      rec.fromDiskCache = !!res.fromDiskCache;
      rec.fromServiceWorker = !!res.fromServiceWorker;
      rec.responseTiming = res.timing || null;
      return;
    }

    if (method === "Network.loadingFinished") {
      const requestId = params.requestId;
      if (!requestId) return;
      const rec = activeRequests.get(requestId);
      if (!rec) return;

      rec.endTs = params.timestamp;
      rec.encodedDataLength = Number(params.encodedDataLength || 0);

      const bodyTask = (async () => {
        if (!includeBodies || rec.skip || !shouldCaptureBodyForUrl(rec.url)) return;
        if (!shouldCaptureBody(rec, maxBodyBytes)) {
          rec.bodyCaptureNote = "skipped";
          return;
        }

        try {
          const bodyRes = await chrome.debugger.sendCommand(debuggee, "Network.getResponseBody", {
            requestId
          });
          const text = typeof bodyRes?.body === "string" ? bodyRes.body : "";
          const base64 = !!bodyRes?.base64Encoded;

          const approxBytes = base64
            ? Math.floor((text.length * 3) / 4)
            : new TextEncoder().encode(text).byteLength;

          if (approxBytes > maxBodyBytes) {
            rec.bodyCaptureNote = "skipped_size";
            return;
          }

          rec.bodyText = text;
          rec.bodyEncoding = base64 ? "base64" : undefined;
          rec.decodedBodyLength = approxBytes;
        } catch {
          rec.bodyCaptureNote = "unavailable";
        }
      })()
        .finally(() => {
          finalizeRecord(rec);
          activeRequests.delete(requestId);
        });

      queueBodyTask(bodyTask);
      return;
    }

    if (method === "Network.loadingFailed") {
      const requestId = params.requestId;
      if (!requestId) return;
      const rec = activeRequests.get(requestId);
      if (!rec) return;

      rec.endTs = params.timestamp;
      rec.failed = true;
      rec.errorText = params.errorText || "loading failed";
      finalizeRecord(rec);
      activeRequests.delete(requestId);
    }
  };

  chrome.debugger.onEvent.addListener(onEvent);

  try {
    await chrome.debugger.attach(debuggee, "1.3");
    attached = true;

    await chrome.debugger.sendCommand(debuggee, "Page.enable");
    await chrome.debugger.sendCommand(debuggee, "Network.enable", {
      maxTotalBufferSize: 100 * 1024 * 1024,
      maxResourceBufferSize: 4 * 1024 * 1024
    });

    await chrome.debugger.sendCommand(debuggee, "Page.reload", { ignoreCache: false });

    const start = Date.now();
    while (Date.now() - start < maxCaptureMs) {
      await sleep(250);
      // SW の寿命を延長するために定期的に Chrome API を呼ぶ (#12)
      chrome.runtime.getPlatformInfo().catch(() => { });
      const idleFor = Date.now() - lastEventAt;
      if (idleFor > idleMs && activeRequests.size === 0 && pendingBodyTasks.size === 0) {
        break;
      }
    }

    if (Date.now() - start >= maxCaptureMs) {
      timedOut = true;
      warnings.push("debugger capture timeout");
    }

    if (pendingBodyTasks.size) {
      await Promise.allSettled([...pendingBodyTasks]);
    }

    for (const rec of activeRequests.values()) {
      rec.failed = true;
      rec.errorText = rec.errorText || "capture ended before completion";
      rec.endTs = rec.endTs || rec.startTs;
      finalizeRecord(rec);
    }
    activeRequests.clear();
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch {
        // ignore
      }
    }
  }

  const entries = [];
  for (const rec of harRecords) {
    const entry = buildHarEntry(rec, { captureStartMs, firstTs });
    if (entry) entries.push(entry);
  }

  return {
    entries,
    meta: {
      mode: "debugger_reload",
      timedOut,
      warnings,
      capturedAt: new Date().toISOString(),
      elapsedMs: Date.now() - captureStartMs,
      entryCount: entries.length
    }
  };
}

// saveCurrentTab は削除 (#1) — saveCurrentTabZip のみ使用

async function saveCurrentTabZip(options) {
  const tab = await getActiveTab();
  await assertHostPermissions(buildRequiredOrigins(tab.url, options));
  if (options?.includeCookies) await assertCookiesPermission();

  const warnings = [];
  let harMeta = null;
  let debuggerEntries = null;
  let debuggerError = null;

  // HAR+debuggerは先にキャプチャしてから、最終状態のHTML/リソースを再収集する。
  if (options?.includeHar && options?.useDebuggerCapture) {
    try {
      await assertDebuggerPermission();
      const cap = await captureHarWithDebugger({ tab, options });
      debuggerEntries = cap.entries;
      harMeta = cap.meta;
      warnings.push(...(cap.meta?.warnings || []));
    } catch (e) {
      debuggerError = String(e?.message || e);
      warnings.push(`debugger capture failed: ${debuggerError}`);
    }
  }

  // Capture後のタブ状態を保存対象とすることで、HARとHTML/assetsの時点ズレを抑える。
  const pageData = await execGatherPageData(tab.id, options);
  if (options?.includeStorage) {
    pageData.storage = await execGatherStorageData(tab.id);
  }
  // debuggerリロードによる遷移でURLが変わる可能性があるため、最終URLでも再検証する。
  await assertHostPermissions(buildRequiredOrigins(pageData.url, options));

  let har = null;
  if (options?.includeHar) {
    if (options?.useDebuggerCapture && debuggerEntries) {
      let finalEntries = debuggerEntries;
      if (options?.sameOriginOnly) {
        finalEntries = debuggerEntries.filter((entry) => {
          try {
            return new URL(entry?.request?.url || "").origin === pageData.origin;
          } catch {
            return false;
          }
        });
      }
      har = buildHarDocument({
        pageData,
        entries: finalEntries,
        captureMeta: {
          ...(harMeta || {}),
          finalPageOrigin: pageData.origin,
          finalEntryCount: finalEntries.length
        }
      });
      harMeta = {
        ...(harMeta || {}),
        finalPageOrigin: pageData.origin,
        finalEntryCount: finalEntries.length
      };
    } else if (options?.useDebuggerCapture) {
      har = buildHarFromPerformance(pageData);
      harMeta = {
        mode: "performance_fallback",
        error: debuggerError || "debugger capture unavailable"
      };
    } else {
      har = buildHarFromPerformance(pageData);
      harMeta = {
        mode: "performance_only",
        entryCount: Array.isArray(har?.log?.entries) ? har.log.entries.length : 0
      };
    }
  }

  const layout = buildLayout(pageData.url, pageData.timestamp);
  const resourceUrls = options?.includeResources ? pageData.resources || [] : [];

  const meta = {
    url: pageData.url,
    title: pageData.title,
    origin: pageData.origin,
    savedAt: new Date(pageData.timestamp).toISOString(),
    options: options || {},
    structure: {
      html: `${layout.host}/${layout.stamp}/html/`,
      data: `${layout.host}/${layout.stamp}/data/`
    },
    warnings
  };

  const entries = [
    {
      path: `${layout.zipDataRoot}meta.json`,
      text: toJsonPretty(meta),
      mime: "application/json"
    },
    {
      path: `${layout.zipHtmlRoot}index.html`,
      text: String(pageData.html || ""),
      mime: "text/html"
    }
  ];

  if (options?.includeNetworkLog && pageData.network) {
    entries.push({
      path: `${layout.zipDataRoot}network.json`,
      text: toJsonPretty(pageData.network),
      mime: "application/json"
    });
  }

  if (options?.includeHar && har) {
    entries.push({
      path: `${layout.zipDataRoot}har.json`,
      text: toJsonPretty(har),
      mime: "application/json"
    });
  }

  if (options?.includeHar && harMeta) {
    entries.push({
      path: `${layout.zipDataRoot}har_meta.json`,
      text: toJsonPretty(harMeta),
      mime: "application/json"
    });
  }

  if (options?.includeStorage && pageData.storage) {
    entries.push({
      path: `${layout.zipDataRoot}storage.json`,
      text: toJsonPretty(pageData.storage),
      mime: "application/json"
    });
  }

  if (options?.includeCookies) {
    const cookies = await chrome.cookies.getAll({ url: pageData.url });
    entries.push({
      path: `${layout.zipDataRoot}cookies.json`,
      text: toJsonPretty({ url: pageData.url, cookies }),
      mime: "application/json"
    });
  }

  await ensureOffscreenDocument();
  const res = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_BUILD_ZIP",
    pageUrl: pageData.url,
    resourceUrls,
    entries,
    assetsPrefix: `${layout.zipHtmlRoot}assets/`,
    reportPath: `${layout.zipDataRoot}report.json`
  });

  if (!res?.ok || !res?.url) throw new Error(res?.error || "zip build failed");

  await chrome.downloads.download({
    url: res.url,
    filename: layout.zipFilename,
    saveAs: false,
    conflictAction: "uniquify"
  });

  await maybeCloseOffscreenDocument();
  return {
    folder: layout.zipFilename,
    url: pageData.url,
    resourceCount: resourceUrls.length,
    warnings: [...warnings, ...(Array.isArray(res.reportWarnings) ? res.reportWarnings : [])]
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    // Internal offscreen messages are handled by offscreen.js.
    if (msg?.type === "OFFSCREEN_BUILD_ZIP") {
      return;
    }

    if (msg?.type === "SAVE_CURRENT_TAB") {
      const opts = msg.options || {};
      const res = await saveCurrentTabZip(opts);
      sendResponse({ ok: true, ...res });
      return;
    }
    if (msg?.type === "OPEN_DOWNLOADS") {
      await chrome.tabs.create({ url: "chrome://downloads/" });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unknown message" });
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });
  return true;
});
