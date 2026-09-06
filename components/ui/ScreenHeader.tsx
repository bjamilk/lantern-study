import React from 'react';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accentColor?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  subtitle,
  icon,
  accentColor = 'bg-lantern-primary-background text-lantern-primary',
  actions,
  className = '',
}) => (
  <header className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 ${className}`}>
    <div className="flex items-start gap-3">
      {icon && (
        <div className={`p-2.5 rounded-lantern shrink-0 ${accentColor}`}>
          {icon}
        </div>
      )}
      <div>
        <h1 className="text-title text-lantern-text">{title}</h1>
        {subtitle && (
          <p className="text-caption text-lantern-text-secondary mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export default ScreenHeader;
