/**
 * The `postMessage` surface of the embed route (#2367, CWE-346).
 *
 * An embedded page can be sent messages by whatever framed it, and `window.postMessage` is a
 * channel every ad script, analytics beacon and browser extension on the parent page also
 * writes to. So a message reaching the embed is guilty until proven innocent, exactly as a
 * peer frame is in `docs/threat-model.md` §5. Four rules, each a line in this file:
 *
 * 1. **Verify `event.origin`.** A message from an origin not on the allowlist is dropped
 *    before its payload is even looked at. This is the check whose absence the threat model
 *    names as the whole risk.
 * 2. **Never trust `event.source`.** The sender's window handle is not read and never replied
 *    to. A reply goes to a verified *origin* string ({@link postToEmbedder}), so a handle
 *    forged or reused by a different frame cannot receive one.
 * 3. **Never post with a wildcard target.** `postMessage(msg, '*')` hands the message to
 *    whatever happens to be framing us; the target is always the specific embedder origin.
 * 4. **Parse into a fresh, validated object.** The payload is read field by known field into a
 *    new object, with the #2365 pollution keys stripped first, so nothing an embedder sends is
 *    trusted for its shape or carried into the prototype chain.
 *
 * The message vocabulary is deliberately tiny and presentational — pause, resume, mute, and a
 * ping for a handshake. None of it can move a piece or change a score: an embedder may frame
 * the game and ask it to quieten down, and that is the whole of the authority it is given.
 */

import { stripForbiddenKeys } from './hardened-json';
import { isAllowedEmbedder } from '../app/frame-guard';

/** The channel tag every DuelBox embed message carries, so foreign `postMessage` is ignored. */
export const EMBED_CHANNEL = 'duelbox-embed';

/** A generous ceiling for a control message; anything larger is not one of ours (DoS guard). */
export const MAX_MESSAGE_CHARS = 4096;

/** A handshake nonce is echoed back, so it is length-capped to keep a reply bounded. */
export const MAX_NONCE_CHARS = 128;

/** Everything an embedder is allowed to ask of the embedded game. */
export type EmbedInbound =
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'setMuted'; readonly muted: boolean }
  | { readonly type: 'ping'; readonly nonce: string };

const INBOUND_TYPES: ReadonlySet<string> = new Set(['pause', 'resume', 'setMuted', 'ping']);

/**
 * Reads a raw `postMessage` payload into a validated {@link EmbedInbound}, or null if it is not
 * one.
 *
 * Accepts either the structured-clone object `postMessage` usually delivers or a JSON string,
 * and treats both with the same suspicion: strip the pollution keys, then read only the fields
 * a known message type declares into a fresh object. An unknown channel, an unknown type, a
 * missing or wrong-typed field, or a payload past the size ceiling all return null rather than
 * throwing — a malformed message is ignored, not an error to propagate.
 */
export function parseEmbedMessage(data: unknown): EmbedInbound | null {
  let raw: unknown = data;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE_CHARS) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  stripForbiddenKeys(raw);
  const record = raw as Record<string, unknown>;

  // Size ceiling for the object form too, so a deeply nested clone cannot be a DoS.
  let serialised: string;
  try {
    serialised = JSON.stringify(record);
  } catch {
    return null;
  }
  if (serialised.length > MAX_MESSAGE_CHARS) return null;

  if (record['channel'] !== EMBED_CHANNEL) return null;
  const type = record['type'];
  if (typeof type !== 'string' || !INBOUND_TYPES.has(type)) return null;

  switch (type) {
    case 'pause':
      return { type: 'pause' };
    case 'resume':
      return { type: 'resume' };
    case 'setMuted': {
      const muted = record['muted'];
      if (typeof muted !== 'boolean') return null;
      return { type: 'setMuted', muted };
    }
    case 'ping': {
      const nonce = record['nonce'];
      if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > MAX_NONCE_CHARS) {
        return null;
      }
      return { type: 'ping', nonce };
    }
    default:
      return null;
  }
}

/** Just the fields of a `MessageEvent` this receiver reads. `source` is pointedly absent. */
export interface EmbedMessageEvent {
  readonly origin: string;
  readonly data: unknown;
}

export interface EmbedReceiverOptions {
  readonly allowlist: readonly string[];
  readonly selfOrigin: string;
  /** Called with the validated message and the verified origin it came from. */
  readonly onMessage: (message: EmbedInbound, origin: string) => void;
}

export type EmbedReceiveResult =
  | { readonly accepted: true; readonly message: EmbedInbound }
  | { readonly accepted: false; readonly reason: string };

/**
 * Handles one inbound message: verify the origin, then parse, then dispatch.
 *
 * Returns why a message was refused, for a test and for a debug log — the runtime effect only
 * cares that a refused message does nothing. `event.source` is never consulted; the verified
 * origin string is what any reply is aimed at.
 */
export function receiveEmbedMessage(
  event: EmbedMessageEvent,
  options: EmbedReceiverOptions,
): EmbedReceiveResult {
  if (!isAllowedEmbedder(event.origin, options.allowlist, options.selfOrigin)) {
    return { accepted: false, reason: `origin ${event.origin} is not on the embed allowlist` };
  }
  const message = parseEmbedMessage(event.data);
  if (message === null) {
    return { accepted: false, reason: 'payload was not a valid embed message' };
  }
  options.onMessage(message, event.origin);
  return { accepted: true, message };
}

/** The window handle a reply is posted through: only `parent.postMessage` is ever used. */
export interface EmbedPoster {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
}

/** A message the embed sends out to its embedder. */
export type EmbedOutbound =
  | { readonly channel: typeof EMBED_CHANNEL; readonly type: 'pong'; readonly nonce: string }
  | { readonly channel: typeof EMBED_CHANNEL; readonly type: 'ready' };

/**
 * Posts a message to the embedder at a specific origin — never `'*'`.
 *
 * Throws on a wildcard or empty target rather than posting, because a wildcard is precisely the
 * mistake this exists to make impossible: it would deliver the message to whatever is framing
 * us at the time, allowlisted or not.
 */
export function postToEmbedder(
  poster: EmbedPoster,
  message: EmbedOutbound,
  targetOrigin: string,
): void {
  if (targetOrigin === '*' || targetOrigin === '') {
    throw new Error('refusing to post to an embedder with a wildcard target origin');
  }
  poster.parent.postMessage(message, targetOrigin);
}
