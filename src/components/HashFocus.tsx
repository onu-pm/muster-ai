'use client';

import { useEffect } from 'react';

/**
 * Scrolls to and briefly highlights the item named in the URL hash.
 *
 * Client-side navigation does not move the viewport to a hash the way a full
 * page load does, so a "Review" link would otherwise appear to do nothing.
 */
export function HashFocus() {
  useEffect(() => {
    function focusHash() {
      const id = window.location.hash.slice(1);
      if (!id) return;

      const element = document.getElementById(id);
      if (!element) return;

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('isFocused');
      const timer = window.setTimeout(
        () => element.classList.remove('isFocused'),
        1800,
      );
      return () => window.clearTimeout(timer);
    }

    focusHash();
    window.addEventListener('hashchange', focusHash);
    return () => window.removeEventListener('hashchange', focusHash);
  }, []);

  return null;
}
