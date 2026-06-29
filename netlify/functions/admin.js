// Admin config — stored server-side in Netlify Blobs (store: "config", key: "settings").
// GET  /admin          → returns config (role-filtered)
// POST /admin          → updates config (action-gated by role)
//
// Roles:
//   sysadmin  — full access; manages admins; cannot be removed by anyone else
//   admin     — can manage departments, customFields, features
//   (everyone else with @domain = viewer; no admin access)
//
// POST actions:
//   updateCompany     sysadmin only  { company: { name, domain, logo, color } }
//   updateAuth        sysadmin only  { auth: { provider, clientId, domain } }
//   addSysAdmin       sysadmin only  { email }
//   removeSysAdmin    sysadmin only  { email }  (cannot remove self if last sysadmin)
//   addAdmin          sysadmin only  { email }
//   removeAdmin       sysadmin only  { email }
//   addJobsAdmin      sysadmin only  { email }
//   removeJobsAdmin   sysadmin only  { email }
//   updateDepartments admin+         { departments: [{name,color}] }
//   updateCustomFields admin+        { customFields: { people:[...], jobs:[...] } }
//   updateFeatures    admin+         { features: { aiAsk, comp, careersPage, ... } }

const { getStore } = require("@netlify/blobs");

// ── Bootstrap defaults (used when config blob doesn't exist yet) ──────────────
const BOOTSTRAP = {
  company: {
    name: "Big Viking Games",
    domain: "bigvikinggames.com",
    logo: "",
    color: "#6366f1"
  },
  auth: {
    provider: "google",
    clientId: "561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com",
    domain: "bigvikinggames.com"
  },
  roles: {
    sysadmins: ["jfurtado@bigvikinggames.com"],
    admins: ["albert@bigvikinggames.com", "rslager@bigvikinggames.com"],
    jobsAdmins: [
      "albert@bigvikinggames.com",
      "jfurtado@bigvikinggames.com",
      "rslager@bigvikinggames.com",
      "smadjunkov@bigvikinggames.com",
      "ggill@bigvikinggames.com",
      "sbendes@bigvikinggames.com"
    ]
  },
  departments: [
    { name: "Executive",             color: "#4A6FA5" },
    { name: "Developers",            color: "#5BAD92" },
    { name: "Art/Animation",         color: "#E07B54" },
    { name: "Product",               color: "#9B72CF" },
    { name: "Production",            color: "#4DBECC" },
    { name: "Finance",               color: "#708090" },
    { name: "Player Support",        color: "#E6A817" },
    { name: "Community",             color: "#5BA4CF" },
    { name: "Quality Assurance",     color: "#6BAD6B" },
    { name: " Content Design",       color: "#888888" },
    { name: "Visual Design",         color: "#C8A84B" },
    { name: "People & Culture",      color: "#C47ABE" },
    { name: "Live Content Marketing",color: "#E84393" },
    { name: "Data Science & Analytics", color: "#3B82F6" }
  ],
  customFields: {
    people: [],
    jobs: []
  },
  features: {
    aiAsk: true,
    comp: true,
    careersPage: true,
    onboarding: false,
    skills: false,
    snapshots: false,
    directory: true,
    headcountAnalytics: false
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function configStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token  = process.env.BLOBS_TOKEN;
  return (siteID && token) ? getStore({ name: "config", siteID, token }) : getStore("config");
}

function jsonResp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

// Verify Google access token → return lowercase email or null
// NOTE: admin does NOT check aud (unlike state/jobs)
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

// Load config from blob, merging with bootstrap defaults for missing keys
async function loadConfig(store) {
  let saved = null;
  try { saved = await store.get("settings", { type: "json" }); } catch {}
  if (!saved) return JSON.parse(JSON.stringify(BOOTSTRAP));
  // Deep-merge saved over bootstrap so new keys added to bootstrap still appear
  return deepMerge(JSON.parse(JSON.stringify(BOOTSTRAP)), saved);
}

function deepMerge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === "object" && !Array.isArray(source[k]) &&
        target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

function roleOf(email, cfg) {
  if (!email) return null;
  if (cfg.roles.sysadmins.includes(email)) return "sysadmin";
  if (cfg.roles.admins.includes(email))    return "admin";
  const domain = cfg.auth.domain || cfg.company.domain;
  if (email.endsWith("@" + domain))        return "viewer";
  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const store = configStore();
  const cfg   = await loadConfig(store);

  const email = await emailFromToken(event.headers);
  const role  = roleOf(email, cfg);

  const qs = event.queryStringParameters || {};

  // ── GET ?branding=1: public branding info (no auth needed) ──────────────
  if (event.httpMethod === "GET" && qs.branding === "1") {
    return jsonResp(200, {
      company: {
        name: cfg.company.name || "",
        logo: cfg.company.logo || "",
        domain: cfg.company.domain || "",
        color: cfg.company.color || ""
      }
    });
  }

  // ── GET: return config filtered by role ────────────────────────────────────
  if (event.httpMethod === "GET") {
    if (!role) return jsonResp(401, { error: "unauthorized" });

    // Auto-bootstrap: persist config blob on first access so other functions
    // (state.js, jobs.js) can read real clientId/roles instead of fallbacks
    let savedExists = false;
    try { savedExists = !!(await store.get("settings", { type: "json" })); } catch {}
    if (!savedExists) {
      try { await store.setJSON("settings", { ...cfg, _bootstrappedAt: new Date().toISOString() }); } catch {}
    }

    // Everyone (admin+) gets the full non-sensitive config
    const out = {
      role,
      company:      cfg.company,
      departments:  cfg.departments,
      customFields: cfg.customFields,
      features:     cfg.features
    };

    // Auth settings and roles only for sysadmin
    if (role === "sysadmin") {
      out.auth  = cfg.auth;
      out.roles = cfg.roles;
    }

    return jsonResp(200, out);
  }

  // ── POST: actions ──────────────────────────────────────────────────────────
  if (event.httpMethod === "POST") {
    if (role !== "sysadmin" && role !== "admin") return jsonResp(403, { error: "forbidden" });

    let body;
    try { body = JSON.parse(event.body); } catch { return jsonResp(400, { error: "bad json" }); }
    const { action } = body;

    // ── Sys-admin-only actions ─────────────────────────────────────────────
    if (["updateCompany","updateAuth","addSysAdmin","removeSysAdmin","addAdmin","removeAdmin","addJobsAdmin","removeJobsAdmin"].includes(action)) {
      if (role !== "sysadmin") return jsonResp(403, { error: "sysadmin only" });
    }

    switch (action) {

      case "updateCompany": {
        const c = body.company || {};
        if (c.name   !== undefined) cfg.company.name   = String(c.name).trim();
        if (c.domain !== undefined) cfg.company.domain = String(c.domain).trim().toLowerCase();
        if (c.logo   !== undefined) cfg.company.logo   = String(c.logo).trim();
        if (c.color  !== undefined) cfg.company.color  = String(c.color).trim();
        break;
      }

      case "updateAuth": {
        const a = body.auth || {};
        if (a.provider !== undefined) cfg.auth.provider = String(a.provider).trim();
        if (a.clientId !== undefined) cfg.auth.clientId = String(a.clientId).trim();
        if (a.domain   !== undefined) cfg.auth.domain   = String(a.domain).trim().toLowerCase();
        break;
      }

      case "addSysAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        if (!e) return jsonResp(400, { error: "email required" });
        if (!cfg.roles.sysadmins.includes(e)) cfg.roles.sysadmins.push(e);
        // Remove from admins if present (no need for dual role)
        cfg.roles.admins = cfg.roles.admins.filter(x => x !== e);
        break;
      }

      case "removeSysAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        if (e === email) return jsonResp(400, { error: "cannot remove yourself" });
        if (cfg.roles.sysadmins.length <= 1) return jsonResp(400, { error: "must have at least one sysadmin" });
        cfg.roles.sysadmins = cfg.roles.sysadmins.filter(x => x !== e);
        break;
      }

      case "addAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        if (!e) return jsonResp(400, { error: "email required" });
        if (cfg.roles.sysadmins.includes(e)) return jsonResp(400, { error: "already a sysadmin" });
        if (!cfg.roles.admins.includes(e)) cfg.roles.admins.push(e);
        break;
      }

      case "removeAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        cfg.roles.admins = cfg.roles.admins.filter(x => x !== e);
        break;
      }

      case "addJobsAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        if (!e) return jsonResp(400, { error: "email required" });
        if (!cfg.roles.jobsAdmins.includes(e)) cfg.roles.jobsAdmins.push(e);
        break;
      }

      case "removeJobsAdmin": {
        const e = String(body.email || "").toLowerCase().trim();
        cfg.roles.jobsAdmins = cfg.roles.jobsAdmins.filter(x => x !== e);
        break;
      }

      case "updateDepartments": {
        const depts = body.departments;
        if (!Array.isArray(depts)) return jsonResp(400, { error: "departments must be array" });
        cfg.departments = depts.map(d => ({
          name:  String(d.name  || "").trim(),
          color: String(d.color || "#888888").trim()
        })).filter(d => d.name);
        break;
      }

      case "updateCustomFields": {
        const cf = body.customFields || {};
        cfg.customFields.people = Array.isArray(cf.people) ? cf.people : cfg.customFields.people;
        cfg.customFields.jobs   = Array.isArray(cf.jobs)   ? cf.jobs   : cfg.customFields.jobs;
        break;
      }

      case "updateFeatures": {
        const f = body.features || {};
        Object.keys(f).forEach(k => { cfg.features[k] = !!f[k]; });
        break;
      }

      default:
        return jsonResp(400, { error: "unknown action: " + action });
    }

    // Save updated config
    try {
      await store.setJSON("settings", { ...cfg, _updatedBy: email, _updatedAt: new Date().toISOString() });
    } catch (e) {
      return jsonResp(500, { error: "save failed: " + String(e.message || e) });
    }

    return jsonResp(200, { ok: true, role });
  }

  return jsonResp(405, { error: "method not allowed" });
};
