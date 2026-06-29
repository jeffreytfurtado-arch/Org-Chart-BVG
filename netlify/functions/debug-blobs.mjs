import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const url = new URL(req.url);
    const storeName = url.searchParams.get('store');
    const key = url.searchParams.get('key');

    if (storeName && key) {
      const store = getStore(storeName);
      const raw = await store.get(key, { type: 'json' });
      if (!raw) return new Response(JSON.stringify({ found: false }), { headers });
      const topKeys = Object.keys(raw);
      const preview = JSON.stringify(raw).substring(0, 500);
      return new Response(JSON.stringify({ found: true, topKeys, preview }), { headers });
    }

    // Check all known stores and their keys
    const results = {};
    const checks = [
      ['orgchart', 'state'],
      ['config', 'settings'],
      ['orgchart-jobs', 'data'],
      ['orgchart-busfactor', 'data'],
      ['raci', 'data'],
      ['bvg-org-chart', 'org-state'],
      ['bvg-org-chart', 'comp'],
      ['bvg-org-chart', 'config'],
      ['jobs', 'list'],
      ['comp', 'data'],
    ];
    for (const [s, k] of checks) {
      try {
        const store = getStore(s);
        const raw = await store.get(k, { type: 'json' });
        results[`${s}/${k}`] = raw ? { found: true, topKeys: Object.keys(raw), preview: JSON.stringify(raw).substring(0, 200) } : { found: false };
      } catch (e) {
        results[`${s}/${k}`] = { error: e.message };
      }
    }
    return new Response(JSON.stringify(results, null, 2), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};
