const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const auth = await verifyAuth(req);
    if (auth.error) return json({ error: auth.error }, auth.status);

    const body = await req.json();
    const { question, context: ctx } = body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return json({ error: 'Question is required' }, 400);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ error: 'AI service not configured' }, 503);
    }

    const systemPrompt = 'You are an AI assistant for Big Viking Games\' org chart tool. Answer questions about the organization, open roles, RACI matrix, and bus factor analysis based on the provided context. Be concise and helpful.';

    const userMessage = `Here is the current organizational data:\n\n${JSON.stringify(ctx, null, 0)}\n\nQuestion: ${question}`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text();
      console.error('Claude API error:', claudeResponse.status, errText);
      return json({ error: 'AI service error', detail: `Claude API returned ${claudeResponse.status}` }, 502);
    }

    const claudeData = await claudeResponse.json();
    const answer = claudeData.content?.[0]?.text || 'No response generated.';

    return json({ answer, engine: 'claude' });
  } catch (e) {
    console.error('ask function error:', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
