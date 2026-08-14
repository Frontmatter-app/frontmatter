import React, { useEffect, useState } from 'react';

interface AccountAvatarProps {
  name: string;
  photoURL?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/**
 * Avatar with an initial behind it.
 *
 * Google profile photo URLs expire, and the desktop build loads them from a
 * webview with no referrer. When one 404s an `<img>` renders as a broken-image
 * glyph, so failures fall back to the initial instead.
 */
export function AccountAvatar({ name, photoURL, size = 'md' }: AccountAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [photoURL]);

  const className = `account-avatar account-avatar--${size}`;

  if (!photoURL || failed) {
    return (
      <span className={className} aria-hidden="true" data-fallback="true">
        {initial(name)}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={photoURL}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
