// "Ask the org" — natural-language Q&A over the org chart + open roles.
// Gated to verified @bigvikinggames.com accounts.
// Engine: by default calls the Anthropic API (key in ANTHROPIC_API_KEY env var).
// If BRAIN_QUERY_URL is set, requests are proxied to the BVG company-brain instead
// (POST {question, context}; optional BRAIN_API_KEY sent as Bearer token).
const CLIENT_ID = "561637209357-n74f7l9n0qrkqq7e37sja2ags5o6ak2e.apps.googleusercontent.com";
const ALLOWED_DOMAIN = "bigvikinggames.com";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

function j(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}
async function emailFromToken(event) {
  const auth = event.headers.authorization || event.headers.Authorization || "";
  const token = String(auth).replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
    if (!r.ok) return null;
    const info = await r.json();
    if (info.aud !== CLIENT_ID) return null;
    const verified = info.email_verified === true || info.email_verified === "true";
    if (!verified) return null;
    return String(info.email || "").toLowerCase();
  } catch (e) { return null; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return j(405, { error: "method" });
  const email = await emailFromToken(event);
  if (!email || !email.endsWith("@" + ALLOWED_DOMAIN)) return j(401, { error: "unauthorized" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return j(400, { error: "bad json" }); }
  const question = String(body.question || "").trim();
  const context = body.context || {};
  if (!question) return j(400, { error: "no question" });

  // ---- Option A: proxy to the BVG company-brain, if configured ----
  if (process.env.BRAIN_QUERY_URL) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (process.env.BRAIN_API_KEY) headers.Authorization = "Bearer " + process.env.BRAIN_API_KEY;
      const r = await fetch(process.env.BRAIN_QUERY_URL, { method: "POST", headers, body: JSON.stringify({ question, context, askedBy: email }) });
      const text = await r.text();
      if (!r.ok) return j(502, { error: "brain error", detail: text.slice(0, 300) });
      let answer = text;
      try { const d = JSON.parse(text); answer = d.answer || d.response || d.text || text; } catch (e) {}
      return j(200, { answer, engine: "bvg-brain" });
    } catch (e) { return j(502, { error: "brain unreachable" }); }
  }

  // ---- Option B: Anthropic API ----
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return j(503, { error: "AI not configured", detail: "Add ANTHROPIC_API_KEY (or BRAIN_QUERY_URL) to this site's Netlify environment variables to enable Ask-the-org." });

  const system = "You are an HR and org-structure assistant for Big Viking Games, a Toronto games studio. " +
    "Answer the user's question using ONLY the JSON data provided (the current org chart and open roles). " +
    "Be concise and specific; use names and titles. If the data does not contain the answer, say so plainly. " +
    "Do not invent people, roles, or numbers. Salary figures are intentionally omitted; if asked about pay, say it isn't available here.";
  const userMsg = "QUESTION:\n" + question + "\n\nORG + ROLES DATA (JSON):\n" + JSON.stringify(context).slice(0, 90000);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content: userMsg }] })
    });
    const d = await r.json();
    if (!r.ok) return j(502, { error: "ai error", detail: (d && d.error && d.error.message) || ("status " + r.status) });
    const answer = (d.content || []).map(c => c.text || "").join("").trim() || "(no answer)";
    return j(200, { answer, engine: MODEL });
  } catch (e) { return j(502, { error: "ai unreachable" }); }
};
