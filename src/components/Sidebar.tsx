'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CatchupIcon,
  HomeIcon,
  MarketplaceIcon,
  TeamIcon,
} from '@/components/Icons';

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

export function Sidebar({ orgName, userEmail, needsYouCount }: Props) {
  const pathname = usePathname();
  const initial = (orgName.trim()[0] ?? '?').toUpperCase();

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="wordmark">Muster</div>

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
            >
              <Icon />
              <span>{label}</span>
              {href === '/catchup' && needsYouCount > 0 ? (
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
        >
          <span className="avatar avatar-sm">{initial}</span>
          <span style={{ minWidth: 0 }}>
            <span className="profileName" style={{ display: 'block' }}>
              {orgName}
            </span>
            <span className="profileSub" style={{ display: 'block' }}>
              {userEmail}
            </span>
          </span>
        </Link>
      </div>
    </nav>
  );
}
