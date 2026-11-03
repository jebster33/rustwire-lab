import { useState } from 'react';
import { iconUrl, itemName } from '../data/items';

const S = (d: string, fill = false) => () => (
  <svg viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const Ic = {
  play: S('M7 4.5v15l12-7.5z', true),
  pause: S('M7 4h3.5v16H7zM13.5 4H17v16h-3.5z', true),
  step: S('M5 4.5v15l10-7.5zM17 4h2.5v16H17z', true),
  undo: S('M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  redo: S('m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
  save: S('M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7'),
  open: S('M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1M3 7h18l-2 12H5z'),
  globe: S('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z'),
  trash: S('M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3'),
  copy: S('M9 9h11v11H9zM5 15H4V4h11v1'),
  calc: S('M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01'),
  help: S('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17h.01'),
  plus: S('M12 5v14M5 12h14'),
  x: S('M6 6l12 12M18 6 6 18'),
  link: S('M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'),
  grid: S('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
  sliders: S('M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4'),
  info: S('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01'),
  bolt: S('M13 2 4 14h7l-1 8 9-12h-7z', true),
  fork: S('M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V3M12 12v9'),
  logout: S('M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10'),
  sun: S('M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'),
};

export function SteamLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-9.96 9.18l5.36 2.22a2.83 2.83 0 0 1 1.6-.5l2.39-3.46v-.05a3.79 3.79 0 1 1 3.79 3.79h-.09l-3.4 2.43a2.84 2.84 0 0 1-5.62.56L2.24 14.6A10 10 0 1 0 12 2zm-4.3 15.2-1.23-.51a2.13 2.13 0 1 0 1.17-2.9l1.27.53a1.57 1.57 0 1 1-1.2 2.9zm9.32-7.86a2.52 2.52 0 1 0-2.52 2.52 2.52 2.52 0 0 0 2.52-2.52zm-4.4 0a1.9 1.9 0 1 1 1.9 1.9 1.89 1.89 0 0 1-1.9-1.9z" />
    </svg>
  );
}

function RecyclerGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="5" y="9" width="38" height="32" rx="3" fill="#3f6b3a" stroke="#1d2e1b" strokeWidth="2" />
      <rect x="10" y="14" width="28" height="10" rx="1" fill="#1a2219" />
      <circle cx="16" cy="33" r="4" fill="#d9c84a" />
      <circle cx="32" cy="33" r="4" fill="#d9c84a" />
      <path d="M14 19h20" stroke="#9bbd6a" strokeWidth="2" strokeDasharray="3 2" />
    </svg>
  );
}

/** Rust item icon, hotlinked, with a drawn fallback if it fails to load. */
export function ItemIcon({ s, size = 40, className = '' }: { s: string; size?: number; className?: string }) {
  const [bad, setBad] = useState(false);
  if (s === 'recycler') return <RecyclerGlyph size={size} />;
  if (bad) {
    const label = itemName(s).split(/\s+/).map((w) => w[0]).join('').slice(0, 3);
    return (
      <span className={`ico-fallback ${className}`} style={{ width: size, height: size, fontSize: Math.max(9, size / 3.2) }} title={itemName(s)}>
        {label}
      </span>
    );
  }
  return (
    <img
      className={`ico ${className}`}
      src={iconUrl(s)}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setBad(true)}
    />
  );
}
