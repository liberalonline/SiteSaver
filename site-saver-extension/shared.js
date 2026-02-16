/**
 * shared.js — sw.js / popup.js / offscreen.js の共通ユーティリティ
 *
 * sw.js:        importScripts("shared.js")
 * popup.html:   <script src="shared.js"></script> (popup.js の前)
 * offscreen.html: <script src="shared.js"></script> (offscreen.js の前)
 */

const ILLEGAL_PATH_RE = /[<>:"|?*\u0000-\u001F]/g;

function sanitizePathComponent(s) {
    const cleaned = String(s || "")
        .replaceAll("/", "_")
        .replaceAll("\\", "_")
        .replace(ILLEGAL_PATH_RE, "_")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.length ? cleaned : "_";
}

function filenameForResource(pageUrl, resourceUrl) {
    const page = new URL(pageUrl);
    const u = new URL(resourceUrl);

    const path = u.pathname && u.pathname !== "/" ? u.pathname : "/index";
    const parts = path.split("/").filter(Boolean).map(sanitizePathComponent);
    let base = parts.join("/");
    if (!base) base = "index";
    if (base.endsWith("_")) base += "index";

    const qf = (u.search || "") + (u.hash || "");
    if (u.origin !== page.origin) {
        const host = sanitizePathComponent(u.host);
        base = `_third_party/${host}/${base}`;
    }

    return { base, needsQueryHash: !!qf, qf };
}

const ALL_HTTP = "http://*/*";
const ALL_HTTPS = "https://*/*";

function originPatternFromUrl(url) {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
}

function buildRequiredOrigins(pageUrl, options) {
    const origins = new Set();

    // Resource fetch (offscreen fetch) and cookies need explicit host permission.
    if (options?.includeResources || options?.includeCookies) {
        origins.add(originPatternFromUrl(pageUrl));
    }
    if (options?.includeResources && !options?.sameOriginOnly) {
        origins.add(ALL_HTTP);
        origins.add(ALL_HTTPS);
    }

    return [...origins];
}
