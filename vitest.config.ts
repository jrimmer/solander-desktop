import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Only run Solander's own tests — exclude the vendored upstream
		// Chatto frontend (in .build/) whose test suite needs a different
		// environment and pollutes the results.
		include: ["src/**/*.spec.ts"],
		exclude: ["node_modules/**", ".build/**", "vendor/**", "dist/**"],
		environment: "node",
	},
});