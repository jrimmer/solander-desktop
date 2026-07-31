/**
 * connectionStatus.ts — Monitors the frontend's realtime connection status
 * and surfaces it in the desktop shell.
 *
 * The Chatto frontend's eventBus.svelte.ts already implements:
 * - Heartbeat watchdog (75s stall detection, 3 missed heartbeats)
 * - Reconnect backoff (5s initial, exponential)
 * - Live/polling/dormant transport modes
 *
 * This module provides a desktop-side view of that status for the shell
 * (offline indicator, reconnection events) and handles desktop-specific
 * concerns like OS sleep/wake detection.
 */

export type ConnectionState =
	| "connected"
	| "connecting"
	| "disconnected"
	| "offline";

export type ConnectionEvent = {
	state: ConnectionState;
	timestamp: number;
	detail?: string;
};

type ConnectionListener = (event: ConnectionEvent) => void;

/**
 * Connection monitor for the desktop shell.
 *
 * In v1, this is a lightweight wrapper that:
 * 1. Listens for connection state changes from the frontend
 * 2. Detects OS sleep/wake via visibility change + time delta
 * 3. Fires events that the shell can use for offline indicators
 */
export class ConnectionMonitor {
	private listeners: Set<ConnectionListener> = new Set();
	private lastActiveAt: number = Date.now();
	private readonly WAKE_THRESHOLD_MS = 30_000; // 30s gap = likely sleep

	constructor() {
		// Detect sleep/wake via visibility changes
		if (typeof document !== "undefined" && document.addEventListener) {
			document.addEventListener("visibilitychange", () => {
				if (document.visibilityState === "visible") {
					const now = Date.now();
					const elapsed = now - this.lastActiveAt;
					if (elapsed > this.WAKE_THRESHOLD_MS) {
						this.emit({
							state: "connecting",
							timestamp: now,
							detail: "wake-from-sleep",
						});
					}
				}
				this.lastActiveAt = Date.now();
			});
		}
	}

	/**
	 * Update the current connection state from the frontend.
	 * Call this when the frontend reports a connection change.
	 */
	updateState(state: ConnectionState, detail?: string): void {
		this.emit({ state, timestamp: Date.now(), detail });
	}

	/**
	 * Register a listener for connection state changes.
	 */
	onStateChange(listener: ConnectionListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(event: ConnectionEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				console.error("[connectionStatus] Listener error:", err);
			}
		}
	}

	/**
	 * Clean up the monitor.
	 */
	destroy(): void {
		this.listeners.clear();
	}
}
