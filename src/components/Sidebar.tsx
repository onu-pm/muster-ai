'use client';

import { useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CatchupIcon,
  CollapseIcon,
  HomeIcon,
  MarketplaceIcon,
  TeamIcon,
} from '@/components/Icons';
import { hueFor } from '@/lib/copy/hue';

const NAV = [
  { href: '/home', label: 'Home', Icon: HomeIcon },
  { href: '/catchup', label: 'Catchup', Icon: CatchupIcon },
  { href: '/team', label: 'Team Members', Icon: TeamIcon },
  { href: '/marketplace', label: 'Marketplace', Icon: MarketplaceIcon },
];

interface Props {
  orgName: string;
  userEmail: string;
  needsYouCount: number;
}

const STORAGE_KEY = 'muster.sidebar.collapsed';

/*
 * Whether the rail is collapsed lives in localStorage, which is outside React.
 * Reading it during render would make the server and the first client render
 * disagree, and writing it from an effect makes React render twice for a value
 * that was already known. useSyncExternalStore is the one that fits: the server
 * snapshot is "expanded", and the client reads the real answer.
 *
 * Every access is wrapped — a private window, blocked site data, or a
 * thumbnail capture all throw rather than returning nothing.
 */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // Not remembering it is a smaller problem than not collapsing at all.
  }
  for (const listener of listeners) listener();
}

export function Sidebar({ orgName, userEmail, needsYouCount }: Props) {
  const pathname = usePathname();
  const initial = (orgName.trim()[0] ?? '?').toUpperCase();

  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  const toggle = useCallback(() => {
    writeCollapsed(!readCollapsed());
  }, []);

  return (
    <nav className="sidebar" aria-label="Main" data-collapsed={collapsed}>
      <div className="sidebarTop">
        <div className="wordmark" aria-label="Muster">
          <span className="wordmarkDot" aria-hidden />
          <span className="wordmarkText">Muster</span>
        </div>

        <button
          type="button"
          className="railToggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
        >
          <CollapseIcon />
          <span className="srOnly">
            {collapsed ? 'Expand the menu' : 'Collapse the menu'}
          </span>
        </button>
      </div>

      <div className="navList">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className="navItem"
              data-active={active}
              aria-current={active ? 'page' : undefined}
              // Collapsed, the icon is all there is, so it needs a name.
              title={collapsed ? label : undefined}
            >
              <Icon />
              <span className="navLabel">{label}</span>
              {needsYouCount > 0 && href === '/catchup' ? (
                <span
                  className="navBadge"
                  aria-label={`${needsYouCount} waiting on you`}
                >
                  {needsYouCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>

      <div className="sidebarFoot">
        <Link
          href="/profile"
          className="profileLink"
          data-active={pathname.startsWith('/profile')}
          title={collapsed ? orgName : undefined}
        >
          <span className="avatar avatar-sm" data-hue={hueFor(orgName)}>
            {initial}
          </span>
          <span className="profileText">
            <span className="profileName">{orgName}</span>
            <span className="profileSub">{userEmail}</span>
          </span>
        </Link>
      </div>
    </nav>
  );
}
