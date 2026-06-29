import { getStore } from '@netlify/blobs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const COMP_AUTHORIZED = [
  'albert@bigvikinggames.com',
  'jfurtado@bigvikinggames.com',
  'rslager@bigvikinggames.com',
];

async function verifyAuth(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header', status: 401 };
  }
  const token = authHeader.slice(7);
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return { error: 'Invalid token', status: 401 };
    const u = await r.json();
    const email = (u.email || '').toLowerCase();
    if (!email.endsWith('@bigvikinggames.com')) {
      return { error: 'Unauthorized domain', status: 403 };
    }
    return { email };
  } catch (e) {
    return { error: 'Token verification failed', status: 401 };
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.error) return json({ error: auth.error }, auth.status);

    if (!COMP_AUTHORIZED.includes(auth.email)) {
      return json({ error: 'Not authorized to view compensation data' }, 403);
    }

    const store = getStore('comp');
    const raw = await store.get('data', { type: 'json' });

    return json({ comp: raw ? (raw.comp || {}) : {} });
  } catch (e) {
    console.error('comp function error:', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
