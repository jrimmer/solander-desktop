import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock window for badge/notification tests
const mockWindow = {
  setBadgeCount: vi.fn(),
  setFocus: vi.fn(),
  show: vi.fn(),
};

// Mock Tauri plugin modules
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => mockWindow),
}));

describe('notifyBridge', () => {
  beforeEach(async () => {
    // Clear call history without resetting implementations
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    (isPermissionGranted as any).mockClear();
    (requestPermission as any).mockClear();
    (sendNotification as any).mockClear();
    (globalThis as any).__TAURI__ = {};
  });

  afterEach(() => {
    delete (globalThis as any).__TAURI__;
  });

  describe('ensureNotificationPermission', () => {
    it('returns false when not in Tauri', async () => {
      const { ensureNotificationPermission } = await import('./notifyBridge');
      const result = await ensureNotificationPermission();
      expect(result).toBe(false);
    });

    it('returns true when permission already granted', async () => {
      const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
      (isPermissionGranted as any).mockResolvedValue(true);

      const { ensureNotificationPermission } = await import('./notifyBridge');
      const result = await ensureNotificationPermission();
      expect(result).toBe(true);
      expect(isPermissionGranted).toHaveBeenCalled();
    });

    it('requests permission when not granted', async () => {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      (isPermissionGranted as any).mockResolvedValue(false);
      (requestPermission as any).mockResolvedValue('granted');

      const { ensureNotificationPermission } = await import('./notifyBridge');
      const result = await ensureNotificationPermission();
      expect(result).toBe(true);
      expect(requestPermission).toHaveBeenCalled();
    });

    it('returns false when permission denied', async () => {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      (isPermissionGranted as any).mockResolvedValue(false);
      (requestPermission as any).mockResolvedValue('denied');

      const { ensureNotificationPermission } = await import('./notifyBridge');
      const result = await ensureNotificationPermission();
      expect(result).toBe(false);
    });
  });

  describe('notify', () => {
    it('sends a notification with title and body', async () => {
      const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      (isPermissionGranted as any).mockResolvedValue(true);

      const { notify } = await import('./notifyBridge');
      await notify({ title: 'New message', body: 'Hello from Chatto' });

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'New message',
        body: 'Hello from Chatto',
      });
    });

    it('does not send notification when not in Tauri', async () => {
      delete (globalThis as any).__TAURI__;
      const { sendNotification } = await import('@tauri-apps/plugin-notification');

      const { notify } = await import('./notifyBridge');
      await notify({ title: 'Test', body: 'Test' });

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('updateBadge', () => {
    it('sets badge count when count > 0', async () => {
      const { updateBadge } = await import('./notifyBridge');
      await updateBadge(5);

      expect(mockWindow.setBadgeCount).toHaveBeenCalledWith(5);
    });

    it('clears badge when count is 0', async () => {
      const { updateBadge } = await import('./notifyBridge');
      await updateBadge(0);

      expect(mockWindow.setBadgeCount).toHaveBeenCalledWith();
    });
  });

  describe('handleNotificationClick', () => {
    it('focuses the window and dispatches navigate event', async () => {
      const { handleNotificationClick } = await import('./notifyBridge');

      // Mock window for the custom event dispatch
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };

      handleNotificationClick({
        title: 'New message',
        body: 'Hello',
        serverId: 'chat-example-com',
        roomId: 'room-123',
        messageId: 'msg-456',
      });

      expect(mockWindow.setFocus).toHaveBeenCalled();
      expect(mockWindow.show).toHaveBeenCalled();
      expect((globalThis as any).window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: {
            serverId: 'chat-example-com',
            roomId: 'room-123',
            messageId: 'msg-456',
          },
        }),
      );

      (globalThis as any).window = originalWindow;
    });
  });
});