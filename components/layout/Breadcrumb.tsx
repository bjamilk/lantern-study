import React from 'react';
import { AppIcon } from '../ui/AppIcon';

export interface BreadcrumbItem {
    label: string;
    onClick?: () => void;
}

interface BreadcrumbProps {
    items: BreadcrumbItem[];
}

/**
 * Breadcrumb navigation for hierarchical screens.
 * Shows: Home > Parent > Current
 * All items except the last are clickable.
 */
const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => {
    if (items.length <= 1) return null;

    return (
        <nav className="flex items-center gap-1 min-w-0 max-w-full overflow-x-auto scrollbar-none text-sm px-4 md:px-6 py-2.5 bg-lantern-surface/60 dark:bg-lantern-surface/60 backdrop-blur-sm border-b border-lantern-border/50" aria-label="Breadcrumb">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                const isFirst = index === 0;

                return (
                    <React.Fragment key={index}>
                        {index > 0 && (
                            <AppIcon name="chevron-forward" size={14} className="text-lantern-text-tertiary flex-shrink-0" />
                        )}
                        {isLast ? (
                            <span className="text-lantern-text font-medium truncate">
                                {item.label}
                            </span>
                        ) : (
                            <button
                                onClick={item.onClick}
                                className="flex items-center gap-1 min-h-[28px] text-lantern-text-secondary hover:text-lantern-primary transition-colors truncate"
                            >
                                {isFirst && <AppIcon name="home" size={14} className="flex-shrink-0" />}
                                <span className="truncate">{item.label}</span>
                            </button>
                        )}
                    </React.Fragment>
                );
            })}
        </nav>
    );
};

export default Breadcrumb;
