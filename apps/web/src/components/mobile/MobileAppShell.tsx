import React from 'react';
import { IUser } from '@crm/shared';
import { NavTab } from '../Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { MobileMoreSheet } from './MobileMoreSheet';

export interface MobileAppShellProps {
  user: IUser;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onLogout: () => void;
  isMoreOpen: boolean;
  onCloseMore: () => void;
  onOpenMore: () => void;
  unreadNotificationsCount?: number;
  onOpenSettingsModal?: () => void;
}

export const MobileAppShell: React.FC<MobileAppShellProps> = ({
  user,
  activeTab,
  onSelectTab,
  onLogout,
  isMoreOpen,
  onCloseMore,
  onOpenMore,
  unreadNotificationsCount,
  onOpenSettingsModal,
}) => {
  return (
    <>
      {/* Mobile Fixed Bottom Navigation */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        user={user}
        onOpenMore={onOpenMore}
        onLogout={onLogout}
        isMoreOpen={isMoreOpen}
        unreadNotificationsCount={unreadNotificationsCount}
      />

      {/* Mobile Bottom More Sheet */}
      <MobileMoreSheet
        isOpen={isMoreOpen}
        onClose={onCloseMore}
        onSelectTab={onSelectTab}
        user={user}
        onLogout={onLogout}
        activeTab={activeTab}
        onOpenSettingsModal={onOpenSettingsModal}
      />
    </>
  );
};
