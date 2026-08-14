import React from 'react';
import { AccountAvatar } from './AccountAvatar';
import { User } from '../types';

interface ActiveAccountCardProps {
  user: User;
  planLabel: string;
}

export function ActiveAccountCard({ user, planLabel }: ActiveAccountCardProps) {
  return (
    <div className="account__identity">
      <AccountAvatar name={user.display_name} photoURL={user.avatar_url} size="lg" />
      <div className="account__identity-text">
        <div className="account__identity-name">
          <span>{user.display_name}</span>
          <span className="account__badge">{planLabel}</span>
        </div>
        <p className="account__identity-email">{user.email || 'No email on this account'}</p>
      </div>
    </div>
  );
}
