import React from 'react';

interface FeatureHeroProps {
  title: string;
  subtitle?: string;
  accentColor?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const FeatureHero: React.FC<FeatureHeroProps> = ({
  title,
  subtitle,
  accentColor = '#4f46e5',
  icon,
  actions,
  children,
  className = '',
}) => (
  <section
    className={`rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-lantern overflow-hidden mb-4 ${className}`}
    style={{ borderTopWidth: 3, borderTopColor: accentColor }}
  >
    <div className="p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          {icon ? (
            <div
              className="p-2.5 rounded-lantern shrink-0"
              style={{ backgroundColor: `${accentColor}18`, color: accentColor }}
            >
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-lantern-text">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-lantern-text-secondary mt-0.5">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  </section>
);

export default FeatureHero;
