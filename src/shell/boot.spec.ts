import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

describe("boot.ts", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Reset the global
		delete (globalThis as any).__SOLANDER__;
	});

	describe("readInjectedConfig", () => {
		it("returns the injected config when __SOLANDER__ is set", async () => {
			const { readInjectedConfig } = await import("./boot");
			(globalThis as any).__SOLANDER__ = {
				serverUrl: "https://chat.example.com",
				desktop: true,
			};

			const config = readInjectedConfig();
			expect(config).toEqual({
				serverUrl: "https://chat.example.com",
				desktop: true,
			});
		});

		it("returns null when __SOLANDER__ is not set", async () => {
			const { readInjectedConfig } = await import("./boot");
			const config = readInjectedConfig();
			expect(config).toBeNull();
		});

		it("returns null when __SOLANDER__ is malformed", async () => {
			const { readInjectedConfig } = await import("./boot");
			(globalThis as any).__SOLANDER__ = "not-an-object";
			const config = readInjectedConfig();
			expect(config).toBeNull();
		});
	});

	describe("getServerConfig", () => {
		it("returns the server URL from the Tauri backend", async () => {
			const { invoke } = await import("@tauri-apps/api/core");
			(invoke as any).mockResolvedValue("https://chat.example.com");

			const { getServerConfig } = await import("./boot");
			const config = await getServerConfig();
			expect(config).toEqual({
				serverUrl: "https://chat.example.com",
				desktop: true,
			});
		});

		it("returns null when no server is configured", async () => {
			const { invoke } = await import("@tauri-apps/api/core");
			(invoke as any).mockResolvedValue(null);

			const { getServerConfig } = await import("./boot");
			const config = await getServerConfig();
			expect(config).toBeNull();
		});

		it("returns null on invoke error", async () => {
			const { invoke } = await import("@tauri-apps/api/core");
			(invoke as any).mockRejectedValue(new Error("IPC error"));

			const { getServerConfig } = await import("./boot");
			const config = await getServerConfig();
			expect(config).toBeNull();
		});
	});

	describe("setServerConfig", () => {
		it("calls invoke with the server URL", async () => {
			const { invoke } = await import("@tauri-apps/api/core");
			(invoke as any).mockResolvedValue(undefined);

			const { setServerConfig } = await import("./boot");
			await setServerConfig("https://chat.example.com");
			expect(invoke).toHaveBeenCalledWith("set_server_url", {
				url: "https://chat.example.com",
			});
		});
	});

	describe("clearServerConfig", () => {
		it("calls invoke to clear the server URL", async () => {
			const { invoke } = await import("@tauri-apps/api/core");
			(invoke as any).mockResolvedValue(undefined);

			const { clearServerConfig } = await import("./boot");
			await clearServerConfig();
			expect(invoke).toHaveBeenCalledWith("clear_server_url");
		});
	});
});
