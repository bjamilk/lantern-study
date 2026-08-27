import React from 'react';
import Modal from './ui/Modal';
import StudyWalletPanel from './StudyWalletPanel';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="study-wallet-heading"
      maxWidthClass="max-w-md"
      panelClassName="!p-0 overflow-hidden max-h-[85vh] flex flex-col"
    >
      <div className="p-5 overflow-y-auto flex-1 bg-lantern-surface">
        <StudyWalletPanel />
      </div>
      <div className="px-5 py-4 border-t border-lantern-border shrink-0 bg-lantern-surface">
        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary rounded-xl hover:bg-lantern-border/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
        >
          Close
        </button>
      </div>
    </Modal>
  );
};

export default WalletModal;
