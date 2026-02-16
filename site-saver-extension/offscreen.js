function bytesToObjectUrl(bytes, mime = "application/octet-stream") {
  if (typeof URL.createObjectURL !== "function") {
    throw new Error(
      "URL.createObjectURL is not available in this context. " +
      "This function must run inside the offscreen document, not a service worker."
    );
  }
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

// sanitizePathComponent, filenameForResource は shared.js で定義

function crc32Table() {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tbl[i] = c >>> 0;
  }
  return tbl;
}

const CRC32_TBL = crc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TBL[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32le(n) {
  const b = new Uint8Array(4);
  const v = n >>> 0;
  b[0] = v & 0xff;
  b[1] = (v >>> 8) & 0xff;
  b[2] = (v >>> 16) & 0xff;
  b[3] = (v >>> 24) & 0xff;
  return b;
}

function u16le(n) {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function concat(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const f of files) {
    const name = String(f.path || "").replace(/^[\\/]+/, "").replaceAll("\\", "/");
    const nameBytes = enc.encode(name);
    const dataBytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array();
    const crc = crc32(dataBytes);

    const lh = [];
    lh.push(u32le(0x04034b50));
    lh.push(u16le(20));
    lh.push(u16le(0x0800)); // UTF-8 flag (bit 11)
    lh.push(u16le(0));
    lh.push(u16le(0));
    lh.push(u16le(0));
    lh.push(u32le(crc));
    lh.push(u32le(dataBytes.length));
    lh.push(u32le(dataBytes.length));
    lh.push(u16le(nameBytes.length));
    lh.push(u16le(0));
    const lhBytes = concat(lh);

    localParts.push(lhBytes, nameBytes, dataBytes);

    const ch = [];
    ch.push(u32le(0x02014b50));
    ch.push(u16le(20));
    ch.push(u16le(20));
    ch.push(u16le(0x0800)); // UTF-8 flag (bit 11)
    ch.push(u16le(0));
    ch.push(u16le(0));
    ch.push(u16le(0));
    ch.push(u32le(crc));
    ch.push(u32le(dataBytes.length));
    ch.push(u32le(dataBytes.length));
    ch.push(u16le(nameBytes.length));
    ch.push(u16le(0));
    ch.push(u16le(0));
    ch.push(u16le(0));
    ch.push(u16le(0));
    ch.push(u32le(0));
    ch.push(u32le(localOffset));
    const chBytes = concat(ch);
    centralParts.push(chBytes, nameBytes);

    localOffset += lhBytes.length + nameBytes.length + dataBytes.length;
  }

  const centralStart = localOffset;
  const centralBytes = concat(centralParts);
  const centralSize = centralBytes.length;

  const eocd = [];
  eocd.push(u32le(0x06054b50));
  eocd.push(u16le(0));
  eocd.push(u16le(0));
  eocd.push(u16le(files.length));
  eocd.push(u16le(files.length));
  eocd.push(u32le(centralSize));
  eocd.push(u32le(centralStart));
  eocd.push(u16le(0));
  const eocdBytes = concat(eocd);

  return concat([...localParts, centralBytes, eocdBytes]);
}

async function limitedMap(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { __error: String(e?.message || e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

function shortHashFromString(s) {
  const b = new TextEncoder().encode(String(s || ""));
  return crc32(b).toString(16).padStart(8, "0");
}

async function fetchBytes(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === "OFFSCREEN_BUILD_ZIP") {
      const { pageUrl, resourceUrls, entries, assetsPrefix, reportPath } = msg || {};
      const enc = new TextEncoder();
      const files = [];

      for (const e of Array.isArray(entries) ? entries : []) {
        files.push({
          path: String(e.path || ""),
          bytes: enc.encode(String(e.text ?? ""))
        });
      }

      const resources = Array.isArray(resourceUrls) ? resourceUrls : [];
      const report = { downloaded: [], failed: [] };

      await limitedMap(resources, 4, async (resourceUrl) => {
        try {
          const nameInfo = filenameForResource(pageUrl, resourceUrl);
          let filename = nameInfo.base;
          if (nameInfo.needsQueryHash) {
            const h = shortHashFromString(nameInfo.qf);
            filename = filename.replace(/(\.[A-Za-z0-9]{1,8})$/, `_${h}$1`);
            if (filename === nameInfo.base) filename = `${filename}_${h}`;
          }

          const bytes = await fetchBytes(resourceUrl);
          const path = `${String(assetsPrefix || "")}${filename}`;
          files.push({ path, bytes });
          report.downloaded.push({ url: resourceUrl, path, size: bytes.length });
        } catch (e) {
          report.failed.push({ url: resourceUrl, error: String(e?.message || e) });
        }
      });

      files.push({
        path: String(reportPath || "data/report.json"),
        bytes: enc.encode(JSON.stringify(report, null, 2) + "\n")
      });

      const zipBytes = zipStore(files);
      const url = bytesToObjectUrl(zipBytes, "application/zip");

      // ZIP の Blob URL は大きいため、ダウンロード完了まで十分な時間を確保。
      // offscreen document の close 時にも自動解放される。
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 10 * 60_000);

      const reportWarnings = report.failed.length
        ? [`zip resources failed: ${report.failed.length}/${resources.length}`]
        : [];

      sendResponse({ ok: true, url, fileCount: files.length, reportWarnings });
      return;
    }

    return;
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });
  return true;
});
