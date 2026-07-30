import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Mock global fetch for token exchange
const mockFetch = vi.fn();

// Predictable CSRF state for tests
const PREDICTABLE_STATE = "test-state-value-1234567890abcdef";

// Mock Tauri plugin modules
vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => {
	const callbacks: Array<(urls: string[]) => void> = [];
	return {
		getCurrent: vi.fn().mockResolvedValue(null),
		onOpenUrl: vi.fn().mockImplementation((cb: (urls: string[]) => void) => {
			callbacks.push(cb);
			return Promise.resolve(() => {
				callbacks.length = 0;
			});
		}),
		_trigger: (urls: string[]) => {
			for (const cb of callbacks) cb(urls);
		},
	};
});

async function triggerDeepLinkCallback(urls: string[]) {
	const mod: any = await import("@tauri-apps/plugin-deep-link");
	if (mod._trigger) mod._trigger(urls);
}

beforeAll(() => {
	vi.stubGlobal("fetch", mockFetch);
	(globalThis as any).__SOLANDER_TEST_STATE__ = PREDICTABLE_STATE;
});
afterAll(() => {
	vi.unstubAllGlobals();
	delete (globalThis as any).__SOLANDER_TEST_STATE__;
});

describe("startOAuthFlow", () => {
	it("returns error for invalid login URL", async () => {
		const { startOAuthFlow } = await import("./oauthClient");
		const result = await startOAuthFlow(
			"https://chat.example.com",
			"not-a-url",
			"deep-link",
		);
		expect(result.success).toBe(false);
	});

	it("returns error when deep-link callback has no code", async () => {
		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback([
			`solander://auth/callback?state=${PREDICTABLE_STATE}`,
		]);

		const result = await promise;
		expect(result.success).toBe(false);
		expect(result).toEqual({
			success: false,
			error: "No authorization code in callback",
		});
	});

	it("returns error when deep-link callback has error param", async () => {
		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback([
			`solander://auth/callback?error=access_denied&error_description=User+cancelled&state=${PREDICTABLE_STATE}`,
		]);

		const result = await promise;
		expect(result.success).toBe(false);
		expect(result).toEqual({
			success: false,
			error: "OAuth error: access_denied",
		});
	});

	it("handles warm-start deep link via onOpenUrl", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "bearer-token" }),
		});

		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback([
			`solander://auth/callback?code=abc123&state=${PREDICTABLE_STATE}`,
		]);

		const result = await promise;
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.token).toBe("bearer-token");
		}
	});

	it("handles cold-start deep link via getCurrent", async () => {
		const deepLink = await import("@tauri-apps/plugin-deep-link");
		deepLink.getCurrent.mockResolvedValue(
			`solander://auth/callback?code=abc123&state=${PREDICTABLE_STATE}`,
		);
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "bearer-token" }),
		});

		const { startOAuthFlow } = await import("./oauthClient");
		const result = await startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.token).toBe("bearer-token");
		}
	});

	it("handles loopback flow", async () => {
		const { invoke } = await import("@tauri-apps/api/core");
		(invoke as any).mockImplementation(async (cmd: string) => {
			if (cmd === "start_oauth_server") return 34567;
			if (cmd === "poll_oauth_callback")
				return `http://127.0.0.1:34567/callback?code=abc123&state=${PREDICTABLE_STATE}`;
			return null;
		});
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "bearer-token" }),
		});

		const { startOAuthFlow } = await import("./oauthClient");
		const result = await startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"loopback",
		);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.token).toBe("bearer-token");
		}
	});

	it("handles token exchange failure", async () => {
		mockFetch.mockRejectedValue(new Error("Token exchange failed"));

		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback([
			`solander://auth/callback?code=abc123&state=${PREDICTABLE_STATE}`,
		]);

		const result = await promise;
		expect(result.success).toBe(false);
		expect(result).toEqual({ success: false, error: "Token exchange failed" });
	});

	it("rejects callback with mismatched state (CSRF protection)", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "should-not-reach-here" }),
		});
		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback([
			"solander://auth/callback?code=abc123&state=wrong-state-value",
		]);

		const result = await promise;
		expect(result.success).toBe(false);
		expect(result).toEqual({
			success: false,
			error: "CSRF validation failed: state mismatch",
		});
	});

	it("rejects callback with missing state (CSRF protection)", async () => {
		mockFetch.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "should-not-reach-here" }),
		});
		const { startOAuthFlow } = await import("./oauthClient");
		const promise = startOAuthFlow(
			"https://chat.example.com",
			"https://chat.example.com/oauth/authorize",
			"deep-link",
		);

		await new Promise((r) => setTimeout(r, 5));
		triggerDeepLinkCallback(["solander://auth/callback?code=abc123"]);

		const result = await promise;
		expect(result.success).toBe(false);
		expect(result).toEqual({
			success: false,
			error: "CSRF validation failed: state mismatch",
		});
	});
});
