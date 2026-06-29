// RACI matrix data, stored server-side in Netlify Blobs.
// V1 Netlify Function (CJS, exports.handler) — Blobs auto-provisions here.
// Read: any verified @domain account. Write: sysadmins + admins (from config).
// Roles are loaded dynamically from the "config" blob (set via admin.js).
const { getStore } = require("@netlify/blobs");

// Fallback values used only if config blob doesn't exist yet
const FALLBACK_DOMAIN  = "bigvikinggames.com";
const FALLBACK_EDITORS = new Set([
  "jfurtado@bigvikinggames.com",
  "albert@bigvikinggames.com",
  "rslager@bigvikinggames.com"
]);
const FALLBACK_CLIENT_ID = "561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com";

function blobStore(name) {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  return (siteID && token) ? getStore({ name, siteID, token }) : getStore(name);
}

function jsonResp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

// Load config once per request (config blob is small, fast read)
async function loadConfig() {
  try {
    const store = blobStore("config");
    const cfg = await store.get("settings", { type: "json" });
    if (cfg && cfg.roles && cfg.auth) return cfg;
  } catch {}
  return null;
}

async function emailFromToken(headers) {
  const auth  = headers["authorization"] || headers["Authorization"] || "";
  const token = String(auth).replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const r    = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
    if (!r.ok) return null;
    const info = await r.json();
    const verified = info.email_verified === true || info.email_verified === "true";
    if (!verified) return null;
    return String(info.email || "").toLowerCase();
  } catch { return null; }
}

exports.handler = async (event) => {
  // Load config (roles, domain, clientId) dynamically
  const cfg = await loadConfig();

  const allowedDomain = (cfg && cfg.auth && cfg.auth.domain) || (cfg && cfg.company && cfg.company.domain) || FALLBACK_DOMAIN;
  const clientId      = (cfg && cfg.auth && cfg.auth.clientId) || FALLBACK_CLIENT_ID;
  const editorEmails  = new Set([
    ...FALLBACK_EDITORS,
    ...((cfg && cfg.roles && cfg.roles.sysadmins) || []),
    ...((cfg && cfg.roles && cfg.roles.admins) || [])
  ]);

  const email = await emailFromToken(event.headers);
  if (!email || !email.endsWith("@" + allowedDomain)) return jsonResp(401, { error: "unauthorized" });

  const canEdit = editorEmails.has(email);

  let store;
  try { store = blobStore("raci"); } catch (e) { return jsonResp(500, { error: "store" }); }

  if (event.httpMethod === "GET") {
    let cur = null;
    try { cur = await store.get("data", { type: "json" }); } catch {}
    if (cur && Array.isArray(cur.domains) && Array.isArray(cur.processes)) {
      return jsonResp(200, { data: { domains: cur.domains, processes: cur.processes }, rev: cur.rev || 0, canEdit });
    }
    return jsonResp(200, { data: null, rev: 0, canEdit });
  }

  if (event.httpMethod === "POST") {
    if (!canEdit) return jsonResp(403, { error: "not an editor" });
    let body;
    try { body = JSON.parse(event.body); } catch { return jsonResp(400, { error: "bad json" }); }
    const domains   = body.domains;
    const processes = body.processes;
    if (!Array.isArray(domains))   return jsonResp(400, { error: "domains must be array" });
    if (!Array.isArray(processes)) return jsonResp(400, { error: "processes must be array" });

    let cur = null;
    try { cur = await store.get("data", { type: "json" }); } catch {}
    const curRev = (cur && cur.rev) ? cur.rev : 0;

    // Conflict detection: reject if client's baseRev is behind current rev
    if (body.baseRev !== undefined && body.baseRev < curRev) {
      return jsonResp(409, { error: "conflict", rev: curRev });
    }

    const rev = curRev + 1;
    await store.setJSON("data", { domains, processes, rev, updatedBy: email, updatedAt: new Date().toISOString() });
    return jsonResp(200, { ok: true, rev });
  }

  return jsonResp(405, { error: "method not allowed" });
};
