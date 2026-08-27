import React, { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import {
  isTaxonomyLeaf,
  taxonomyForest,
  type MarketplaceDepartment,
  type TaxonomyTreeNode,
} from '@lantern/shared/marketplace';

interface MarketplaceBrowseTreeProps {
  department: MarketplaceDepartment;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}

const TreeBranch: React.FC<{
  branch: TaxonomyTreeNode;
  selectedNodeId: string;
  depth: number;
  onSelectNode: (nodeId: string) => void;
}> = ({ branch, selectedNodeId, depth, onSelectNode }) => {
  const selectable = isTaxonomyLeaf(branch.node) || branch.children.length > 0;
  const [open, setOpen] = useState(
    depth < 1 || selectedNodeId === branch.node.id || selectedNodeId.startsWith(`${branch.node.id}.`),
  );
  const selected = selectedNodeId === branch.node.id;
  const hasChildren = branch.children.length > 0;

  return (
    <div>
      <div className="flex items-center gap-0.5" style={{ paddingLeft: depth * 10 }}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${branch.node.label}` : `Expand ${branch.node.label}`}
            onClick={() => setOpen((value) => !value)}
            className="p-1 rounded text-lantern-text-tertiary hover:text-lantern-text"
          >
            {open ? <ChevronDownIcon className="w-3.5 h-3.5" /> : <ChevronRightIcon className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          type="button"
          onClick={() => selectable && onSelectNode(branch.node.id)}
          className={`flex-1 min-w-0 text-left rounded-md px-1.5 py-1 text-[12px] leading-tight ${
            selected
              ? 'bg-lantern-primary text-white font-semibold'
              : 'text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text'
          }`}
        >
          <span className="block truncate">{branch.node.label}</span>
        </button>
      </div>
      {hasChildren && open
        ? branch.children.map((child) => (
            <TreeBranch
              key={child.node.id}
              branch={child}
              selectedNodeId={selectedNodeId}
              depth={depth + 1}
              onSelectNode={onSelectNode}
            />
          ))
        : null}
    </div>
  );
};

export const MarketplaceBrowseTree: React.FC<MarketplaceBrowseTreeProps> = ({
  department,
  selectedNodeId,
  onSelectNode,
}) => {
  const forest = taxonomyForest(department);
  return (
    <nav aria-label="Browse listing types" className="space-y-1">
      <button
        type="button"
        onClick={() => onSelectNode('')}
        className={`w-full text-left rounded-md px-2 py-1.5 text-[12px] font-medium ${
          !selectedNodeId
            ? 'bg-lantern-primary text-white'
            : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
        }`}
      >
        All types
      </button>
      {forest.map((branch) => (
        <TreeBranch
          key={branch.node.id}
          branch={branch}
          selectedNodeId={selectedNodeId}
          depth={0}
          onSelectNode={onSelectNode}
        />
      ))}
    </nav>
  );
};
