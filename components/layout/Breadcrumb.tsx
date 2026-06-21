import React from 'react';
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/solid';

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
        <nav className="flex items-center gap-1 min-w-0 max-w-full overflow-x-hidden text-sm px-4 md:px-6 py-2.5 bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700/50" aria-label="Breadcrumb">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                const isFirst = index === 0;

                return (
                    <React.Fragment key={index}>
                        {index > 0 && (
                            <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                        )}
                        {isLast ? (
                            <span className="text-slate-800 dark:text-slate-200 font-medium truncate">
                                {item.label}
                            </span>
                        ) : (
                            <button
                                onClick={item.onClick}
                                className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors truncate"
                            >
                                {isFirst && <HomeIcon className="w-3.5 h-3.5 flex-shrink-0" />}
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
