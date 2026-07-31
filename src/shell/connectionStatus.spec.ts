import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function setupDocument() {
	const listeners: Record<string, Array<() => void>> = {};
	const doc = {
		visibilityState: "visible",
		addEventListener: vi.fn((event: string, cb: () => void) => {
			if (!listeners[event]) listeners[event] = [];
			listeners[event].push(cb);
		}),
		removeEventListener: vi.fn(),
	};
	(globalThis as any).document = doc;
	return { doc, listeners };
}

describe("ConnectionMonitor", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete (globalThis as any).document;
	});

	it("emits state changes to registered listeners", async () => {
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const listener = vi.fn();

		monitor.onStateChange(listener);
		monitor.updateState("connected");

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ state: "connected" }),
		);
	});

	it("allows unregistering listeners", async () => {
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const listener = vi.fn();

		const unsubscribe = monitor.onStateChange(listener);
		unsubscribe();
		monitor.updateState("disconnected");

		expect(listener).not.toHaveBeenCalled();
	});

	it("handles multiple listeners", async () => {
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const listener1 = vi.fn();
		const listener2 = vi.fn();

		monitor.onStateChange(listener1);
		monitor.onStateChange(listener2);
		monitor.updateState("offline");

		expect(listener1).toHaveBeenCalledTimes(1);
		expect(listener2).toHaveBeenCalledTimes(1);
	});

	it("does not throw when a listener throws", async () => {
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const throwingListener = vi.fn().mockImplementation(() => {
			throw new Error("listener error");
		});

		monitor.onStateChange(throwingListener);
		expect(() => monitor.updateState("connected")).not.toThrow();
	});

	it("detects wake-from-sleep on visibility change after long gap", async () => {
		const { doc, listeners } = setupDocument();
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const listener = vi.fn();

		monitor.onStateChange(listener);

		// Simulate sleep: set lastActiveAt far in the past
		(monitor as any).lastActiveAt = Date.now() - 60_000;

		// Simulate visibility change to visible
		doc.visibilityState = "visible";
		// Trigger the registered visibilitychange listener
		for (const cb of listeners["visibilitychange"] || []) {
			cb();
		}

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "connecting",
				detail: "wake-from-sleep",
			}),
		);
	});

	it("does not emit wake event for short visibility gaps", async () => {
		const { doc, listeners } = setupDocument();
		const { ConnectionMonitor } = await import("./connectionStatus");
		const monitor = new ConnectionMonitor();
		const listener = vi.fn();

		monitor.onStateChange(listener);

		// Small gap (5s) — below threshold
		(monitor as any).lastActiveAt = Date.now() - 5_000;

		doc.visibilityState = "visible";
		for (const cb of listeners["visibilitychange"] || []) {
			cb();
		}

		expect(listener).not.toHaveBeenCalled();
	});
});
