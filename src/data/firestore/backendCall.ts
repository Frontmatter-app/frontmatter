/**
 * Authenticated calls to the Modal backend.
 *
 * Some operations cannot be done from the client at all, because the documents
 * they touch are deliberately not client-writable: team membership records are
 * the proof the security rules read, and clearing a removed member's own user
 * record is a write into someone else's document. Both need Admin credentials,
 * so they go through the backend.
 */
import { getAuth } from 'firebase/auth';

export async function backendCall<T = unknown>(
  path: string,
  body: unknown,
  method: 'POST' | 'GET' = 'POST',
): Promise<T> {
  const baseUrl = import.meta.env.VITE_MODAL_BASE_URL || '';
  if (!baseUrl) throw new Error('VITE_MODAL_BASE_URL is not configured.');

  const user = getAuth().currentUser;
  if (!user) throw new Error('Not signed in.');
  const idToken = await user.getIdToken();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((payload) => payload?.detail)
      .catch(() => null);
    throw new Error(detail || `Request to ${path} failed (${res.status}).`);
  }

  return (await res.json()) as T;
}
