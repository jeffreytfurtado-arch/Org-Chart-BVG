import { getStore } from '@netlify/blobs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const EDITOR_EMAILS = [
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

  try {
    const auth = await verifyAuth(req);
    if (auth.error) return json({ error: auth.error }, auth.status);

    const store = getStore('orgchart');

    if (req.method === 'GET') {
      const raw = await store.get('state', { type: 'json' });
      if (!raw) {
        return json({ state: { employees: [], secondaryLinks: [] }, rev: 0 });
      }
      // Handle both formats: flat { employees, secondaryLinks, rev } and nested { state: {...}, rev }
      const employees = raw.state?.employees || raw.employees || [];
      const secondaryLinks = raw.state?.secondaryLinks || raw.secondaryLinks || [];
      return json({ state: { employees, secondaryLinks }, rev: raw.rev || 0 });
    }

    if (req.method === 'POST') {
      if (!EDITOR_EMAILS.includes(auth.email)) {
        return json({ error: 'Not an editor' }, 403);
      }
      const body = await req.json();
      const { baseRev, employees, secondaryLinks } = body;

      const raw = await store.get('state', { type: 'json' });
      const currentRev = raw ? (raw.rev || 0) : 0;

      if (baseRev !== undefined && baseRev !== currentRev) {
        return json({ error: 'Conflict', currentRev }, 409);
      }

      const newRev = currentRev + 1;
      // Store in flat format to match original function behavior
      await store.set('state', JSON.stringify({
        employees: employees || [],
        secondaryLinks: secondaryLinks || [],
        rev: newRev,
        updatedBy: auth.email,
        updatedAt: new Date().toISOString(),
      }));

      return json({ rev: newRev });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('state function error:', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
