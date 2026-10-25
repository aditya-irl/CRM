import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { ApiClient } from '../services/api';

/**
 * Mobile platform detector and native Capacitor initialization.
 * Configures system insets, status bar contrast, keyboard resize modes,
 * hardware back button navigation, and persistent native authentication.
 */
export async function initMobileApp(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  // 1. Restore persistent authentication tokens for native mobile
  try {
    await ApiClient.restoreNativeSession();
  } catch (err) {
    console.warn('[Mobile] Failed to restore native session:', err);
  }

  // 2. Configure Status Bar for iOS & Android
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#ffffff' });
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch (err) {
    console.warn('[Mobile] StatusBar configuration warning:', err);
  }

  // 3. Configure Virtual Keyboard behavior
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setScroll({ isDisabled: false });
  } catch (err) {
    console.warn('[Mobile] Keyboard configuration warning:', err);
  }

  // 4. Register Android Hardware Back Button handler
  try {
    await CapApp.addListener('backButton', ({ canGoBack }) => {
      // Dispatch custom back press event so open modals/drawers can handle first
      const event = new CustomEvent('crm_native_back_pressed', { cancelable: true });
      const wasHandled = !window.dispatchEvent(event);
      if (wasHandled) {
        return;
      }

      // Check if hash history exists or not on root dashboard
      const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '').trim() : '';
      if (hash && hash !== 'dashboard') {
        window.history.back();
      } else if (canGoBack) {
        window.history.back();
      } else {
        // At root dashboard with no open modals: exit/minimize app
        CapApp.exitApp();
      }
    });
  } catch (err) {
    console.warn('[Mobile] Back button registration warning:', err);
  }
}
