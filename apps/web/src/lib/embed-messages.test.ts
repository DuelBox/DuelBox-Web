import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELF_TOKEN } from '../app/frame-guard';
import {
  EMBED_CHANNEL,
  MAX_MESSAGE_CHARS,
  MAX_NONCE_CHARS,
  parseEmbedMessage,
  postToEmbedder,
  receiveEmbedMessage,
} from './embed-messages';

const SELF = 'https://duelbox.example';
const ALLY = 'https://portal.example';
const ALLOWLIST = [SELF_TOKEN, ALLY];

function msg(extra: Record<string, unknown>): Record<string, unknown> {
  return { channel: EMBED_CHANNEL, ...extra };
}

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)['polluted'];
});

describe('parseEmbedMessage', () => {
  it('accepts the four known messages, as objects and as JSON strings', () => {
    expect(parseEmbedMessage(msg({ type: 'pause' }))).toEqual({ type: 'pause' });
    expect(parseEmbedMessage(msg({ type: 'resume' }))).toEqual({ type: 'resume' });
    expect(parseEmbedMessage(msg({ type: 'setMuted', muted: true }))).toEqual({
      type: 'setMuted',
      muted: true,
    });
    expect(parseEmbedMessage(JSON.stringify(msg({ type: 'ping', nonce: 'abc' })))).toEqual({
      type: 'ping',
      nonce: 'abc',
    });
  });

  it('drops a foreign channel, an unknown type, and a wrong-typed field', () => {
    expect(parseEmbedMessage(msg({ type: 'pause', channel: 'someone-else' }))).toBeNull();
    expect(parseEmbedMessage(msg({ type: 'explode' }))).toBeNull();
    expect(parseEmbedMessage(msg({ type: 'setMuted', muted: 'yes' }))).toBeNull();
    expect(parseEmbedMessage(msg({ type: 'ping' }))).toBeNull();
    expect(parseEmbedMessage(msg({ type: 'ping', nonce: '' }))).toBeNull();
  });

  it('drops non-objects, arrays and unparseable strings', () => {
    for (const value of [null, undefined, 7, true, [], '{not json']) {
      expect(parseEmbedMessage(value)).toBeNull();
    }
  });

  it('drops an oversized payload before doing anything with it', () => {
    const huge = msg({ type: 'ping', nonce: 'x'.repeat(MAX_NONCE_CHARS + 1) });
    expect(parseEmbedMessage(huge)).toBeNull();
    const longString = JSON.stringify(msg({ type: 'pause', pad: 'x'.repeat(MAX_MESSAGE_CHARS) }));
    expect(longString.length).toBeGreaterThan(MAX_MESSAGE_CHARS);
    expect(parseEmbedMessage(longString)).toBeNull();
  });

  it('strips a pollution payload rather than carrying it into the runtime', () => {
    const poisoned = `{"channel":"${EMBED_CHANNEL}","type":"pause","__proto__":{"polluted":1}}`;
    expect(parseEmbedMessage(poisoned)).toEqual({ type: 'pause' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('receiveEmbedMessage', () => {
  it('ignores a message from a non-allowlisted origin, without parsing it', () => {
    const onMessage = vi.fn();
    const result = receiveEmbedMessage(
      { origin: 'https://evil.example', data: msg({ type: 'pause' }) },
      { allowlist: ALLOWLIST, selfOrigin: SELF, onMessage },
    );
    expect(result.accepted).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('accepts and dispatches a valid message from an allowlisted origin', () => {
    const onMessage = vi.fn();
    const result = receiveEmbedMessage(
      { origin: ALLY, data: msg({ type: 'setMuted', muted: true }) },
      { allowlist: ALLOWLIST, selfOrigin: SELF, onMessage },
    );
    expect(result).toEqual({ accepted: true, message: { type: 'setMuted', muted: true } });
    expect(onMessage).toHaveBeenCalledWith({ type: 'setMuted', muted: true }, ALLY);
  });

  it('refuses a malformed message even from an allowlisted origin', () => {
    const onMessage = vi.fn();
    const result = receiveEmbedMessage(
      { origin: ALLY, data: msg({ type: 'explode' }) },
      { allowlist: ALLOWLIST, selfOrigin: SELF, onMessage },
    );
    expect(result.accepted).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('never reads event.source', () => {
    // The event object exposes no `source`, and the receiver still works — the handle is
    // simply not part of its contract.
    const onMessage = vi.fn();
    receiveEmbedMessage(
      { origin: ALLY, data: msg({ type: 'pause' }) },
      { allowlist: ALLOWLIST, selfOrigin: SELF, onMessage },
    );
    expect(onMessage).toHaveBeenCalledWith({ type: 'pause' }, ALLY);
  });
});

describe('postToEmbedder', () => {
  it('posts to a specific origin', () => {
    const postMessage = vi.fn();
    postToEmbedder({ parent: { postMessage } }, { channel: EMBED_CHANNEL, type: 'ready' }, ALLY);
    expect(postMessage).toHaveBeenCalledWith({ channel: EMBED_CHANNEL, type: 'ready' }, ALLY);
  });

  it('refuses a wildcard or empty target origin', () => {
    const postMessage = vi.fn();
    expect(() =>
      postToEmbedder({ parent: { postMessage } }, { channel: EMBED_CHANNEL, type: 'ready' }, '*'),
    ).toThrow(/wildcard/);
    expect(() =>
      postToEmbedder({ parent: { postMessage } }, { channel: EMBED_CHANNEL, type: 'ready' }, ''),
    ).toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
