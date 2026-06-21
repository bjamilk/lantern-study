import React from 'react';
import { AdminShell } from './admin/AdminShell';

interface AdminScreenProps {
  onBackToDashboard: () => void;
}

const AdminScreen: React.FC<AdminScreenProps> = ({ onBackToDashboard }) => (
  <div className="flex flex-1 flex-col min-h-0 w-full">
    <AdminShell onBackToDashboard={onBackToDashboard} />
  </div>
);

export default AdminScreen;
