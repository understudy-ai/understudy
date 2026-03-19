/**
 * Shared constants for gateway-backed TUI chat and teach routing.
 *
 * Both `chat-gateway-session.ts` and `chat-interactive-teach.ts` use these
 * identifiers when communicating with the gateway session API. Keeping them
 * in one place prevents silent divergence.
 */

/** Channel identifier sent with every gateway session RPC call from the TUI. */
export const CHAT_GATEWAY_CHANNEL_ID = "terminal";

/** Sender identifier sent with every gateway session RPC call from the TUI. */
export const CHAT_GATEWAY_SENDER_ID = "understudy-chat";

/** URI prefix used to distinguish gateway session paths from local file paths. */
export const GATEWAY_SESSION_PATH_PREFIX = "understudy-gateway-session://";

/**
 * Message API format identifier for the TUI rendering layer.
 *
 * The TUI (pi-coding-agent) uses this to select the correct message renderer.
 * It is a rendering format tag, not a provider coupling.
 */
export const GATEWAY_MESSAGE_API = "openai-codex-responses";

/** Default number of recent history items to keep when compacting a gateway session. */
export const GATEWAY_COMPACT_KEEP = 20;
