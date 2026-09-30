import React from 'react';

export interface BrandLogoProps {
  variant?: 'full' | 'horizontal' | 'mark' | 'receipt' | 'compact';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLegal?: boolean;
  subtitle?: string;
  className?: string;
  style?: React.CSSProperties;
  colorTheme?: 'dark' | 'light' | 'receipt';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'horizontal',
  size = 'md',
  showLegal = true,
  subtitle,
  className = '',
  style = {},
  colorTheme = 'dark',
}) => {
  // Determine pixel sizes
  const markDimensions = {
    sm: 28,
    md: 36,
    lg: 44,
    xl: 56,
  }[size];

  const brandFontSize = {
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
  }[size];

  const legalFontSize = {
    sm: 9,
    md: 10.5,
    lg: 11.5,
    xl: 13,
  }[size];

  const isReceipt = variant === 'receipt' || colorTheme === 'receipt';

  // Vector SVG Geometric Emblem
  const Emblem = (
    <svg
      width={markDimensions}
      height={markDimensions}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`bl-navy-${size}`} x1="12" y1="8" x2="24" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isReceipt ? '#0f172a' : '#0f172a'} />
          <stop offset="100%" stopColor={isReceipt ? '#1e293b' : '#1e293b'} />
        </linearGradient>
        <linearGradient id={`bl-terra-${size}`} x1="24" y1="8" x2="36" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isReceipt ? '#334155' : '#ea580c'} />
          <stop offset="100%" stopColor={isReceipt ? '#0f172a' : '#b8532f'} />
        </linearGradient>
        <linearGradient id={`bl-gold-${size}`} x1="18" y1="27" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isReceipt ? '#64748b' : '#fb923c'} />
          <stop offset="100%" stopColor={isReceipt ? '#475569' : '#f59e0b'} />
        </linearGradient>
      </defs>

      {/* Abstract A - Left Smartphone Contour Pillar */}
      <path
        d="M12 37L21.6 9.6C21.9 8.6 22.8 8 23.9 8H24.1C25.2 8 26.1 8.6 26.4 9.6L36 37C36.4 38.2 35.5 39.5 34.2 39.5H30.6C29.7 39.5 28.9 38.9 28.6 38.1L26.2 31H21.8L19.4 38.1C19.1 38.9 18.3 39.5 17.4 39.5H13.8C12.5 39.5 11.6 38.2 12 37Z"
        fill={`url(#bl-navy-${size})`}
      />

      {/* Abstract A - Right Smartphone Bezel Pillar */}
      <path
        d="M24 8H24.1C25.2 8 26.1 8.6 26.4 9.6L36 37C36.4 38.2 35.5 39.5 34.2 39.5H30.6C29.7 39.5 28.9 38.9 28.6 38.1L26.2 31H24V8Z"
        fill={`url(#bl-terra-${size})`}
      />

      {/* Device Top Speaker / Notch Indicator */}
      <rect x="21.5" y="10.5" width="5" height="1.8" rx="0.9" fill="#ffffff" opacity="0.95" />

      {/* Screen Cutout */}
      <polygon points="24,15.5 27.8,26.5 20.2,26.5" fill="#f8fafc" />

      {/* EMI / Secure Payment Smart Chip Connector */}
      <rect x="18" y="27" width="12" height="3" rx="1.5" fill={`url(#bl-gold-${size})`} />
      <circle cx="24" cy="28.5" r="1.2" fill="#ffffff" />
    </svg>
  );

  if (variant === 'mark') {
    return (
      <div
        className={`brand-logo-mark ${className}`}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
        title="Alpha Mobile Gallery (Shubh Pvt Ltd)"
      >
        {Emblem}
      </div>
    );
  }

  return (
    <div
      className={`brand-logo-container ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'sm' ? 8 : 12,
        userSelect: 'none',
        ...style,
      }}
    >
      {Emblem}

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.15 }}>
        <div
          style={{
            fontSize: brandFontSize,
            fontWeight: 800,
            color: isReceipt ? '#0f172a' : 'var(--text-primary)',
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          Alpha Mobile Gallery
        </div>

        {(showLegal || subtitle) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: legalFontSize,
              marginTop: 2,
              whiteSpace: 'nowrap',
            }}
          >
            {showLegal && (
              <span
                style={{
                  fontWeight: 700,
                  color: isReceipt ? '#0f172a' : 'var(--primary)',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                SHUBH PVT LTD
              </span>
            )}
            {showLegal && subtitle && (
              <span style={{ color: 'var(--text-muted)' }}>•</span>
            )}
            {subtitle && (
              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                {subtitle}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
