import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const store = getStore('orgchart');
    const raw = await store.get('state', { type: 'json' });

    if (!raw) {
      return new Response(JSON.stringify({ found: false, raw: null }), { headers });
    }

    const topKeys = Object.keys(raw);
    const hasState = !!raw.state;
    const hasEmployees = hasState && Array.isArray(raw.state.employees);
    const empCount = hasEmployees ? raw.state.employees.length : 0;
    const hasSecondary = hasState && Array.isArray(raw.state.secondaryLinks);
    const secondaryCount = hasSecondary ? raw.state.secondaryLinks.length : 0;
    const rev = raw.rev;
    const firstEmp = hasEmployees && empCount > 0 ? raw.state.employees[0] : null;

    // Also check if the data IS the state directly (not nested under .state)
    const directEmployees = Array.isArray(raw.employees);
    const directEmpCount = directEmployees ? raw.employees.length : 0;

    return new Response(JSON.stringify({
      found: true,
      topKeys,
      hasState,
      hasEmployees,
      empCount,
      hasSecondary,
      secondaryCount,
      rev,
      firstEmp: firstEmp ? { name: firstEmp.name, email: firstEmp.email, id: firstEmp.id } : null,
      directEmployees,
      directEmpCount,
      rawType: typeof raw,
    }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};
