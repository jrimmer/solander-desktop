import { describe, it, expect } from "vitest";

describe("media", () => {
	describe("getPlatformCapability", () => {
		it("returns supported for non-Linux platforms", async () => {
			const { getPlatformCapability } = await import("./media");
			const cap = getPlatformCapability();
			expect(cap.mic).toBe("supported");
			expect(cap.camera).toBe("supported");
			expect(cap.screenShare).toBe("supported");
			expect(cap.voiceCall).toBe("supported");
		});

		it("returns unsupported for Linux", async () => {
			// Mock navigator.platform via defineProperty
			const originalPlatform = (globalThis as any).navigator?.platform;
			Object.defineProperty(globalThis, "navigator", {
				value: { platform: "linux" },
				configurable: true,
				writable: true,
			});

			const { getPlatformCapability } = await import("./media");
			const cap = getPlatformCapability();
			expect(cap.mic).toBe("unsupported");
			expect(cap.camera).toBe("unsupported");
			expect(cap.screenShare).toBe("unsupported");
			expect(cap.voiceCall).toBe("unsupported");

			// Restore
			Object.defineProperty(globalThis, "navigator", {
				value: originalPlatform ? { platform: originalPlatform } : undefined,
				configurable: true,
				writable: true,
			});
		});
	});

	describe("getMic", () => {
		it("returns unsupported", async () => {
			const { getMic } = await import("./media");
			const result = (await getMic()) as { success: false; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toContain("not yet supported");
		});
	});

	describe("getCamera", () => {
		it("returns unsupported", async () => {
			const { getCamera } = await import("./media");
			const result = (await getCamera()) as { success: false; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toContain("not yet supported");
		});
	});

	describe("getScreen", () => {
		it("returns unsupported", async () => {
			const { getScreen } = await import("./media");
			const result = (await getScreen()) as { success: false; error: string };
			expect(result.success).toBe(false);
			expect(result.error).toContain("not yet supported");
		});
	});

	describe("joinRoom", () => {
		it("returns unsupported", async () => {
			const { joinRoom } = await import("./media");
			const result = (await joinRoom("wss://example.com", "token")) as {
				success: false;
				error: string;
			};
			expect(result.success).toBe(false);
			expect(result.error).toContain("not yet supported");
		});
	});
});
