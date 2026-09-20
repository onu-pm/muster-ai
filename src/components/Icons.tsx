interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export function HomeIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function CatchupIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4 5h16" />
      <path d="M4 12h10" />
      <path d="M4 19h7" />
      <circle cx="18" cy="17" r="3.2" />
    </svg>
  );
}

export function TeamIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.7 5.7 0 0 1 11 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.6 14.4a5.7 5.7 0 0 1 2.9 5.1" />
    </svg>
  );
}

export function MarketplaceIcon({ size = 17 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <path d="M17 14v6M14 17h6" />
    </svg>
  );
}

export function CheckIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function PlugIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M9 3v6M15 3v6" />
      <path d="M6 9h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M5 12h13" />
      <path d="m12.5 6 6 6-6 6" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="m4 12 16-8-6 16-2.5-6.5z" />
    </svg>
  );
}

export function SpinnerIcon({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)} className="spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
