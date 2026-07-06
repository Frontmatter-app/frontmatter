import type { User } from '../types';

export function getCurrentUserName(user: User | null): string {
  return user?.display_name || user?.email?.split('@')[0] || 'User';
}
