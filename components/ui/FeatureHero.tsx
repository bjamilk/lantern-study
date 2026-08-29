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
      {/* Wrap on CONTENT width, not viewport breakpoints: with the sidebar
          open, an sm: row layout gets a ~460px column at 768-900px windows,
          and a shrink-0 actions block then overlapped the title and squeezed
          the subtitle to one word per line. flex-wrap + a basis floor on the
          title block drops the actions onto their own line instead. */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1 basis-64">
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
        {actions ? <div className="flex flex-wrap items-center gap-2 min-w-0">{actions}</div> : null}
      </div>
      {children}
    </div>
  </section>
);

export default FeatureHero;
