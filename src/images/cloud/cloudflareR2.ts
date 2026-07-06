const R2_API_BASE = import.meta.env.VITE_R2_API_BASE_URL || 'https://api.marktype.io/r2';

async function getIdToken(): Promise<string> {
  const { auth } = await import('../../auth/firebase');
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  return user.getIdToken();
}

async function r2Request(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  const res = await fetch(`${R2_API_BASE}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`R2 request failed: ${res.status} ${res.statusText}`);
  return res;
}

export async function uploadToR2(
  key: string,
  data: Uint8Array,
  contentType: string,
  teamId: string
): Promise<void> {
  const blob = new Blob([data], { type: contentType });
  await r2Request(`/upload/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'x-team-id': teamId },
    body: blob,
  });
}

export async function downloadFromR2(
  key: string,
  teamId: string
): Promise<Blob> {
  const res = await r2Request(
    `/download/${encodeURIComponent(key)}?teamId=${encodeURIComponent(teamId)}`
  );
  return res.blob();
}

export async function deleteFromR2(key: string, teamId: string): Promise<void> {
  await r2Request(`/${encodeURIComponent(key)}?teamId=${encodeURIComponent(teamId)}`, {
    method: 'DELETE',
  });
}

export function getR2PublicUrl(key: string): string {
  return `${R2_API_BASE}/public/${encodeURIComponent(key)}`;
}
