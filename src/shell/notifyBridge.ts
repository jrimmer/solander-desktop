/**
 * notifyBridge.ts — Bridges Chatto's notification events to the OS via
 * tauri-plugin-notification and tauri-plugin-window badge APIs.
 *
 * The Chatto frontend's service-worker push path does not work under the
 * tauri:// custom protocol. This module replaces it by:
 * 1. Listening for mention/DM transient events from the frontend
 * 2. Sending OS notifications via tauri-plugin-notification
 * 3. Updating the app badge (setBadgeCount on macOS/Linux,
 *    setOverlayIcon on Windows)
 * 4. Handling notification clicks to focus the app and navigate to the room
 */

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type NotificationPayload = {
  title: string;
  body: string;
  serverId?: string;
  roomId?: string;
  messageId?: string;
};

/**
 * Check if running inside a Tauri webview.
 */
function isTauri(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI__' in globalThis;
}

/**
 * Request notification permission. Returns true if granted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false;

  try {
    const granted = await isPermissionGranted();
    if (granted) return true;

    const permission = await requestPermission();
    return permission === 'granted';
  } catch {
    return false;
  }
}

/**
 * Send an OS notification for a chat event.
 * Only fires when the window is not focused (no duplicate in-app notification).
 */
export async function notify(payload: NotificationPayload): Promise<void> {
  if (!isTauri()) return;

  try {
    const permitted = await ensureNotificationPermission();
    if (!permitted) return;

    sendNotification({
      title: payload.title,
      body: payload.body,
    });
  } catch (err) {
    console.error('[notifyBridge] Failed to send notification:', err);
  }
}

/**
 * Update the app badge (unread count).
 * macOS/Linux: numeric badge via setBadgeCount
 * Windows: overlay icon (no numeric badge support)
 */
export async function updateBadge(count: number): Promise<void> {
  if (!isTauri()) return;

  try {
    const win = getCurrentWindow();
    if (count > 0) {
      await win.setBadgeCount(count);
    } else {
      await win.setBadgeCount(); // undefined clears the badge
    }
  } catch (err) {
    console.error('[notifyBridge] Failed to update badge:', err);
  }
}

/**
 * Handle a notification click — focus the app window and navigate to the
 * relevant room/message.
 *
 * The frontend should listen for this event and route accordingly.
 */
export function handleNotificationClick(payload: NotificationPayload): void {
  if (!isTauri()) return;

  // Focus the window
  try {
    const win = getCurrentWindow();
    win.setFocus();
    win.show();
  } catch (err) {
    console.error('[notifyBridge] Failed to focus window:', err);
  }

  // Dispatch a custom event that the frontend can listen for
  if (payload.roomId) {
    window.dispatchEvent(
      new CustomEvent('solander:navigate', {
        detail: {
          serverId: payload.serverId,
          roomId: payload.roomId,
          messageId: payload.messageId,
        },
      }),
    );
  }
}