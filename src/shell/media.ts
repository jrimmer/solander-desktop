/**
 * media.ts — Voice/media abstraction seam for Solander.
 *
 * Defines the interface for future LiveKit voice/video/screenshare integration.
 * Currently returns "unsupported" for all operations.
 *
 * Per-platform capability:
 * - macOS: potentially supported (needs entitlement + permission verification)
 * - Windows: potentially supported (needs WebView2 permission verification)
 * - Linux (WebKitGTK): unsupported — no WebRTC/getUserMedia
 *
 * This module is the single entry point for media acquisition. When LiveKit
 * integration is added, the implementation behind this interface changes
 * without touching call sites.
 */

export type MediaCapability = "supported" | "unsupported";

export type MediaResult<T> =
	| { success: true; value: T }
	| { success: false; error: string };

export type PlatformCapability = {
	mic: MediaCapability;
	camera: MediaCapability;
	screenShare: MediaCapability;
	voiceCall: MediaCapability;
};

/**
 * Get the platform's media capabilities.
 */
export function getPlatformCapability(): PlatformCapability {
	// Detect Linux WebKitGTK — no WebRTC
	const isLinux =
		typeof navigator !== "undefined" &&
		navigator.platform?.toLowerCase().includes("linux");

	if (isLinux) {
		return {
			mic: "unsupported",
			camera: "unsupported",
			screenShare: "unsupported",
			voiceCall: "unsupported",
		};
	}

	// macOS and Windows are potentially supported
	return {
		mic: "supported",
		camera: "supported",
		screenShare: "supported",
		voiceCall: "supported",
	};
}

/**
 * Request microphone access.
 * Currently returns unsupported.
 */
export async function getMic(): Promise<MediaResult<MediaStream>> {
	return {
		success: false,
		error: "Voice calls are not yet supported in Solander.",
	};
}

/**
 * Request camera access.
 * Currently returns unsupported.
 */
export async function getCamera(): Promise<MediaResult<MediaStream>> {
	return {
		success: false,
		error: "Video calls are not yet supported in Solander.",
	};
}

/**
 * Request screen share access.
 * Currently returns unsupported.
 */
export async function getScreen(): Promise<MediaResult<MediaStream>> {
	return {
		success: false,
		error: "Screen sharing is not yet supported in Solander.",
	};
}

/**
 * Join a voice/video call room.
 * Currently returns unsupported.
 */
export async function joinRoom(
	_roomUrl: string,
	_token: string,
): Promise<MediaResult<void>> {
	return {
		success: false,
		error: "Voice/video calls are not yet supported in Solander.",
	};
}
