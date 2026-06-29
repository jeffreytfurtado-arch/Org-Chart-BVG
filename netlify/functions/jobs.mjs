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

const JOBS_EDITOR_EMAILS = [
  ...EDITOR_EMAILS,
  'smadjunkov@bigvikinggames.com',
  'ggill@bigvikinggames.com',
  'sbendes@bigvikinggames.com',
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

    const store = getStore('orgchart-jobs');
    const url = new URL(req.url);

    if (req.method === 'GET') {
      // File download mode
      const fileId = url.searchParams.get('file');
      if (fileId) {
        const fileStore = getStore('jobfiles');
        const fileData = await fileStore.get(fileId, { type: 'json' });
        if (!fileData) {
          return json({ error: 'File not found' }, 404);
        }
        const buffer = Buffer.from(fileData.dataB64, 'base64');
        return new Response(buffer, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': fileData.type || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileData.name || 'file')}"`,
          },
        });
      }

      // List jobs mode
      const raw = await store.get('data', { type: 'json' });
      const canEdit = JOBS_EDITOR_EMAILS.includes(auth.email);
      if (!raw) {
        return json({ jobs: [], rev: 0, canEdit });
      }
      return json({ jobs: raw.jobs || [], rev: raw.rev || 0, canEdit });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { action } = body;

      if (action === 'upload') {
        if (!JOBS_EDITOR_EMAILS.includes(auth.email)) {
          return json({ error: 'Not a jobs editor' }, 403);
        }
        const { name, type, dataB64 } = body;
        if (!dataB64) {
          return json({ error: 'Missing file data' }, 400);
        }
        const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const size = Math.ceil((dataB64.length * 3) / 4);
        const fileStore = getStore('jobfiles');
        await fileStore.set(fileId, JSON.stringify({ name, type, dataB64 }));

        return json({
          fileId,
          name: name || 'file',
          type: type || 'application/octet-stream',
          size,
          uploadedAt: new Date().toISOString(),
          uploadedBy: auth.email,
        });
      }

      if (action === 'save') {
        if (!JOBS_EDITOR_EMAILS.includes(auth.email)) {
          return json({ error: 'Not a jobs editor' }, 403);
        }
        const { baseRev, jobs } = body;
        const raw = await store.get('data', { type: 'json' });
        const currentRev = raw ? (raw.rev || 0) : 0;

        if (baseRev !== undefined && baseRev !== currentRev) {
          return json({ error: 'Conflict', currentRev }, 409);
        }

        const newRev = currentRev + 1;
        await store.set('data', JSON.stringify({ jobs, rev: newRev }));
        return json({ rev: newRev });
      }

      return json({ error: 'Unknown action' }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('jobs function error:', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
