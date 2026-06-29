import { getStore } from '@netlify/blobs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const DEFAULT_CONFIG = {
  company: {
    name: 'Big Viking Games',
    domain: 'bigvikinggames.com',
    logo: '',
    color: '#6366f1',
  },
  departments: [
    { name: 'Executive', color: '#1a1a2e' },
    { name: 'Developers', color: '#2563eb' },
    { name: 'Art/Animation', color: '#7c3aed' },
    { name: 'Product', color: '#0891b2' },
    { name: 'Data Science & Analytics', color: '#059669' },
    { name: 'People & Culture', color: '#d946ef' },
    { name: 'Finance', color: '#ea580c' },
    { name: 'QA', color: '#dc2626' },
    { name: 'Player Support', color: '#4f46e5' },
    { name: 'Community', color: '#0d9488' },
    { name: 'Production', color: '#ca8a04' },
  ],
  customFields: { people: [], jobs: [] },
  features: {
    aiAsk: true,
    comp: true,
    careersPage: false,
    directory: false,
    headcountAnalytics: false,
    onboarding: false,
    skills: false,
    snapshots: false,
  },
  auth: {
    provider: 'google',
    domain: 'bigvikinggames.com',
    clientId: '',
  },
  roles: {
    sysadmins: ['albert@bigvikinggames.com', 'jfurtado@bigvikinggames.com'],
    admins: ['rslager@bigvikinggames.com'],
    jobsAdmins: ['smadjunkov@bigvikinggames.com', 'ggill@bigvikinggames.com', 'sbendes@bigvikinggames.com'],
  },
};

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

async function getConfig(store) {
  const raw = await store.get('config', { type: 'json' });
  if (!raw) return { ...DEFAULT_CONFIG };
  // Merge with defaults for any missing keys
  return {
    company: { ...DEFAULT_CONFIG.company, ...(raw.company || {}) },
    departments: raw.departments || DEFAULT_CONFIG.departments,
    customFields: raw.customFields || DEFAULT_CONFIG.customFields,
    features: { ...DEFAULT_CONFIG.features, ...(raw.features || {}) },
    auth: { ...DEFAULT_CONFIG.auth, ...(raw.auth || {}) },
    roles: {
      sysadmins: raw.roles?.sysadmins || DEFAULT_CONFIG.roles.sysadmins,
      admins: raw.roles?.admins || DEFAULT_CONFIG.roles.admins,
      jobsAdmins: raw.roles?.jobsAdmins || DEFAULT_CONFIG.roles.jobsAdmins,
    },
  };
}

async function saveConfig(store, config) {
  await store.set('config', JSON.stringify(config));
}

function getUserRole(email, config) {
  if (config.roles.sysadmins.includes(email)) return 'sysadmin';
  if (config.roles.admins.includes(email)) return 'admin';
  return null;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  try {
    const store = getStore('orgchart-admin');
    const url = new URL(req.url);

    if (req.method === 'GET') {
      // Public branding endpoint (no auth required)
      if (url.searchParams.get('branding') === '1') {
        const config = await getConfig(store);
        return json({
          company: {
            name: config.company.name,
            domain: config.company.domain,
            logo: config.company.logo,
            color: config.company.color,
          },
        });
      }

      // Authenticated full config
      const auth = await verifyAuth(req);
      if (auth.error) return json({ error: auth.error }, auth.status);

      const config = await getConfig(store);
      const role = getUserRole(auth.email, config);

      return json({
        role,
        company: config.company,
        departments: config.departments,
        customFields: config.customFields,
        features: config.features,
        auth: role === 'sysadmin' ? config.auth : undefined,
        roles: role === 'sysadmin' ? config.roles : undefined,
      });
    }

    if (req.method === 'POST') {
      const auth = await verifyAuth(req);
      if (auth.error) return json({ error: auth.error }, auth.status);

      const config = await getConfig(store);
      const role = getUserRole(auth.email, config);

      if (!role) {
        return json({ error: 'Not an admin' }, 403);
      }

      const body = await req.json();
      const { action } = body;

      // Actions available to admin and sysadmin
      if (action === 'updateDepartments') {
        config.departments = body.departments || [];
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'updateCustomFields') {
        config.customFields = body.customFields || { people: [], jobs: [] };
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'updateFeatures') {
        config.features = { ...config.features, ...(body.features || {}) };
        await saveConfig(store, config);
        return json({ ok: true });
      }

      // Sysadmin-only actions
      if (role !== 'sysadmin') {
        return json({ error: 'Sysadmin access required' }, 403);
      }

      if (action === 'updateCompany') {
        config.company = { ...config.company, ...(body.company || {}) };
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'updateAuth') {
        config.auth = { ...config.auth, ...(body.auth || {}) };
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'addSysAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        if (!email) return json({ error: 'Email required' }, 400);
        if (!config.roles.sysadmins.includes(email)) {
          config.roles.sysadmins.push(email);
        }
        // Remove from admins if present (sysadmin supersedes admin)
        config.roles.admins = config.roles.admins.filter(e => e !== email);
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'removeSysAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        if (email === auth.email) return json({ error: 'Cannot remove yourself' }, 400);
        config.roles.sysadmins = config.roles.sysadmins.filter(e => e !== email);
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'addAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        if (!email) return json({ error: 'Email required' }, 400);
        if (!config.roles.admins.includes(email)) {
          config.roles.admins.push(email);
        }
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'removeAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        config.roles.admins = config.roles.admins.filter(e => e !== email);
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'addJobsAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        if (!email) return json({ error: 'Email required' }, 400);
        if (!config.roles.jobsAdmins.includes(email)) {
          config.roles.jobsAdmins.push(email);
        }
        await saveConfig(store, config);
        return json({ ok: true });
      }

      if (action === 'removeJobsAdmin') {
        const email = (body.email || '').toLowerCase().trim();
        config.roles.jobsAdmins = config.roles.jobsAdmins.filter(e => e !== email);
        await saveConfig(store, config);
        return json({ ok: true });
      }

      return json({ error: 'Unknown action' }, 400);
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    console.error('admin function error:', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
