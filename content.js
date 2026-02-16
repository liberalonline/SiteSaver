function isHttpUrl(u) {
  try {
    const url = new URL(u, location.href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function gatherLoadedResources({ sameOriginOnly } = {}) {
  const origin = location.origin;
  const urls = new Set();

  // performance entries are the closest to "actually loaded"
  try {
    for (const e of performance.getEntriesByType("resource")) {
      if (typeof e?.name !== "string") continue;
      if (!isHttpUrl(e.name)) continue;
      if (sameOriginOnly) {
        try {
          if (new URL(e.name).origin !== origin) continue;
        } catch {
          continue;
        }
      }
      urls.add(e.name);
    }
  } catch {
    // ignore
  }

  // add obvious DOM-referenced assets (some won't appear in perf entries until loaded)
  const domUrls = [];
  document.querySelectorAll("script[src]").forEach((n) => domUrls.push(n.src));
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((n) => domUrls.push(n.href));
  document.querySelectorAll("img[src]").forEach((n) => domUrls.push(n.src));
  document.querySelectorAll("source[src]").forEach((n) => domUrls.push(n.src));
  document.querySelectorAll("video[src],audio[src]").forEach((n) => domUrls.push(n.src));

  for (const u of domUrls) {
    if (!u || !isHttpUrl(u)) continue;
    if (sameOriginOnly) {
      try {
        if (new URL(u).origin !== origin) continue;
      } catch {
        continue;
      }
    }
    urls.add(u);
  }

  return [...urls];
}

function gatherNetworkLog({ sameOriginOnly } = {}) {
  const origin = location.origin;
  const items = [];

  try {
    for (const e of performance.getEntriesByType("resource")) {
      if (typeof e?.name !== "string") continue;
      if (!isHttpUrl(e.name)) continue;
      if (sameOriginOnly) {
        try {
          if (new URL(e.name).origin !== origin) continue;
        } catch {
          continue;
        }
      }

      // PerformanceResourceTiming fields (some may be 0 due to TAO/CORS).
      const o = {
        name: e.name,
        initiatorType: e.initiatorType || "",
        startTime: e.startTime,
        duration: e.duration,
        nextHopProtocol: e.nextHopProtocol || "",
        workerStart: e.workerStart,
        redirectStart: e.redirectStart,
        redirectEnd: e.redirectEnd,
        fetchStart: e.fetchStart,
        domainLookupStart: e.domainLookupStart,
        domainLookupEnd: e.domainLookupEnd,
        connectStart: e.connectStart,
        secureConnectionStart: e.secureConnectionStart,
        connectEnd: e.connectEnd,
        requestStart: e.requestStart,
        responseStart: e.responseStart,
        responseEnd: e.responseEnd,
        transferSize: e.transferSize,
        encodedBodySize: e.encodedBodySize,
        decodedBodySize: e.decodedBodySize
      };

      // Chrome may expose responseStatus on PerformanceResourceTiming.
      if (typeof e.responseStatus === "number") o.responseStatus = e.responseStatus;

      items.push(o);
    }
  } catch {
    // ignore
  }

  return {
    capturedAt: Date.now(),
    timeOrigin: performance.timeOrigin || null,
    resources: items
  };
}

// Called via chrome.scripting.executeScript
function gatherPageData(options) {
  const sameOriginOnly = !!options?.sameOriginOnly;
  const includeResources = !!options?.includeResources;
  const includeNetworkLog = !!options?.includeNetworkLog;

  const data = {
    url: location.href,
    origin: location.origin,
    title: document.title || "",
    timestamp: Date.now(),
    html: document.documentElement ? document.documentElement.outerHTML : "",
    resources: includeResources ? gatherLoadedResources({ sameOriginOnly }) : [],
    network: includeNetworkLog ? gatherNetworkLog({ sameOriginOnly }) : null,
    // storage は SW から MAIN world で別途取得する。
    storage: null
  };

  return data;
}

// Expose for executeScript function injection fallback patterns.
globalThis.gatherPageData = gatherPageData;
