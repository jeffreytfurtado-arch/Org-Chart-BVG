// Jobs / Open Roles repository — shared server-side state in Netlify Blobs.
// V1 Netlify Function (CJS, exports.handler) — Blobs auto-provisions here.
//   Read (jobs list + JD downloads): any verified @domain account.
//   Public careers feed: GET ?public=1 (no auth).
//   Write (save list, upload/delete JD files): sysadmins + admins + jobsAdmins (from config).
// Roles are loaded dynamically from the "config" blob (set via admin.js).
const { getStore } = require("@netlify/blobs");

// Fallback values used only if config blob doesn't exist yet
const FALLBACK_CLIENT_ID    = "561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com";
const FALLBACK_DOMAIN       = "bigvikinggames.com";
const FALLBACK_JOBS_EDITORS = new Set([
  "albert@bigvikinggames.com",
  "jfurtado@bigvikinggames.com",
  "rslager@bigvikinggames.com",
  "smadjunkov@bigvikinggames.com",
  "ggill@bigvikinggames.com",
  "sbendes@bigvikinggames.com"
]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;

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

// Load config once per request
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
  const qs = event.queryStringParameters || {};

  // ---- Diagnostic: GET ?diag=1 ----
  if (event.httpMethod === "GET" && qs.diag) {
    const out = [];
    out.push("BLOBS_SITE_ID set: " + (!!process.env.BLOBS_SITE_ID));
    out.push("BLOBS_TOKEN set: "    + (!!process.env.BLOBS_TOKEN));
    out.push("NETLIFY_BLOBS_CONTEXT set: " + (!!process.env.NETLIFY_BLOBS_CONTEXT));
    out.push("runtime: " + (process.version || "?"));
    try {
      const s = blobStore("jobs");
      await s.set("__diag__", "ok-" + Date.now());
      const v = await s.get("__diag__");
      out.push("blob write/read: OK (" + v + ")");
    } catch (e) {
      out.push("blob ERROR: " + String((e && (e.stack || e.message)) || e));
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      body: out.join("\n")
    };
  }

  // ---- Public, no-auth: sanitized active roles for the careers page ----
  if (event.httpMethod === "GET" && qs.public) {
    let store;
    try { store = blobStore("jobs"); } catch { return jsonResp(500, { error: "store" }); }
    let cur = null;
    try { cur = await store.get("list", { type: "json" }); } catch {}
    const ACTIVE = new Set(["Approved", "Open", "Interviewing", "Offer"]);
    const jobs = (((cur && cur.jobs) || []).filter(x => ACTIVE.has(x.status))).map(x => ({
      title: x.title, dept: x.dept, location: x.location, type: x.type, dateOpened: x.dateOpened,
      workable: x.workable || "", linkedin: x.linkedin || "",
      jd: (x.jdFiles && x.jdFiles[0] && x.jdFiles[0].url) ? x.jdFiles[0].url : ""
    }));
    return jsonResp(200, { jobs });
  }

  // Load config dynamically
  const cfg = await loadConfig();

  const allowedDomain  = (cfg && cfg.auth && cfg.auth.domain) || (cfg && cfg.company && cfg.company.domain) || FALLBACK_DOMAIN;
  const clientId       = (cfg && cfg.auth && cfg.auth.clientId) || FALLBACK_CLIENT_ID;

  // Jobs editors = fallback + sysadmins + admins + jobsAdmins
  const editorsSet = new Set([
    ...FALLBACK_JOBS_EDITORS,
    ...((cfg && cfg.roles && cfg.roles.sysadmins)  || []),
    ...((cfg && cfg.roles && cfg.roles.admins)      || []),
    ...((cfg && cfg.roles && cfg.roles.jobsAdmins)  || [])
  ]);

  const email = await emailFromToken(event.headers);
  if (!email || !email.endsWith("@" + allowedDomain)) return jsonResp(401, { error: "unauthorized" });
  const canEdit = editorsSet.has(email);

  let list, files;
  try { list = blobStore("jobs"); files = blobStore("jobfiles"); }
  catch { return jsonResp(500, { error: "store" }); }

  // ---- GET ----
  if (event.httpMethod === "GET") {
    const fileId = qs.file;
    if (fileId) {
      let rec = null;
      try { rec = await files.get("f_" + fileId, { type: "json" }); } catch {}
      if (!rec || !rec.dataB64) return jsonResp(404, { error: "not found" });
      return {
        statusCode: 200,
        headers: {
          "Content-Type": rec.type || "application/octet-stream",
          "Content-Disposition": 'attachment; filename="' + (rec.name || "jd").replace(/"/g, "") + '"',
          "Cache-Control": "no-store"
        },
        body: rec.dataB64,
        isBase64Encoded: true
      };
    }
    let cur = null;
    try { cur = await list.get("list", { type: "json" }); } catch {}
    if (cur && Array.isArray(cur.jobs)) return jsonResp(200, { jobs: cur.jobs, rev: cur.rev || 0, canEdit });
    return jsonResp(200, { jobs: null, rev: 0, canEdit });
  }

  // ---- POST (editors only) ----
  if (event.httpMethod === "POST") {
    if (!canEdit) return jsonResp(403, { error: "not an editor" });
    let body;
    try { body = JSON.parse(event.body); } catch { return jsonResp(400, { error: "bad json" }); }
    const action = body.action || "save";

    if (action === "upload") {
      const data = String(body.dataB64 || "");
      if (!data) return jsonResp(400, { error: "no data" });
      const approxBytes = Math.floor(data.length * 0.75);
      if (approxBytes > MAX_FILE_BYTES) return jsonResp(413, { error: "file too large (max 8 MB)" });
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const rec = {
        name: String(body.name || "jd").slice(0, 200),
        type: String(body.type || "application/octet-stream").slice(0, 100),
        size: approxBytes,
        dataB64: data,
        uploadedBy: email,
        uploadedAt: new Date().toISOString()
      };
      try { await files.setJSON("f_" + fileId, rec); } catch { return jsonResp(500, { error: "save file" }); }
      return jsonResp(200, { fileId, name: rec.name, type: rec.type, size: rec.size, uploadedBy: email, uploadedAt: rec.uploadedAt });
    }

    if (action === "deletefile") {
      const id = String(body.fileId || "");
      if (!id) return jsonResp(400, { error: "no id" });
      try { await files.delete("f_" + id); } catch {}
      return jsonResp(200, { ok: true });
    }

    // Default action: save jobs list
    const jobs = body.jobs;
    if (!Array.isArray(jobs)) return jsonResp(400, { error: "jobs must be array" });
    let cur = null;
    try { cur = await list.get("list", { type: "json" }); } catch {}
    const rev = (cur && cur.rev) ? cur.rev + 1 : 1;
    await list.setJSON("list", { jobs, rev, updatedBy: email, updatedAt: new Date().toISOString() });
    return jsonResp(200, { ok: true, rev });
  }

  return jsonResp(405, { error: "method not allowed" });
};
