import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';

/**
 * Enterprise Secure Storage Adapter for Financial CRM.
 * Exclusively uses hardware-backed Keystore (Android) and Keychain (iOS) via SecureStorage.
 * Unencrypted storage fallbacks are strictly prohibited for financial tokens.
 */
export class NativeTokenStorage {
  /**
   * Retrieves an item from hardware-backed secure storage.
   * Fails safely without reading unencrypted storage fallbacks.
   */
  public static async getItem(key: string): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) return null;
    const val = await SecureStorage.get(key);
    if (val === null || val === undefined) {
      return null;
    }
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  /**
   * Securely saves an item to hardware-backed secure storage.
   * Throws an error if encryption fails, refusing to write to unencrypted storage.
   */
  public static async setItem(key: string, value: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    await SecureStorage.set(key, value);
  }

  /**
   * Purges an item from hardware-backed secure storage.
   * Also purges legacy Preferences keys if any exist from older versions.
   */
  public static async removeItem(key: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await SecureStorage.remove(key);
    } catch (e) {
      console.warn(`[NativeTokenStorage] Failed to remove secure key "${key}":`, e);
    }
    // Clean up any stale legacy unencrypted Preferences entry
    try {
      await Preferences.remove({ key });
    } catch {}
  }
}
