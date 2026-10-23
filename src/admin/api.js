export async function api(method, path, body) {
  try {
    const res = await fetch(`/api/admin${path}`, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { ok: true, data } : { ok: false, error: data?.error || 'That didn’t work. Please try again.' };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server. Check your connection.' };
  }
}
