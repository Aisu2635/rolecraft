/**
 * Genuine AWS data quirks the sweep tolerates. Each entry needs a comment naming the
 * service/action and why. Keys are "service:Action" or a service key; value is an issue id.
 */
export const KNOWN_QUIRKS: ReadonlyArray<{ service: string; issueId: string; reason: string }> = [];
