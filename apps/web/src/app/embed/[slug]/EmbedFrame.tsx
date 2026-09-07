'use client';

import { useEffect, useState } from 'react';
import { PlaySurface } from '@/components/PlaySurface';
import { checkFrame, EMBED_ALLOWED_ORIGINS, type FrameWindow } from '@/app/frame-guard';
import {
  EMBED_CHANNEL,
  type EmbedPoster,
  postToEmbedder,
  receiveEmbedMessage,
} from '@/lib/embed-messages';
import { embedBacklinkLabel } from '@/lib/embed';
import styles from './EmbedFrame.module.css';

export interface EmbedFrameProps {
  readonly slug: string;
  readonly gameName: string;
  /** Absolute URL back to the game's own page, shown when a disallowed origin frames us. */
  readonly backlinkHref: string;
}

/**
 * The client half of the embed route: it enforces the frame allowlist and owns the
 * `postMessage` channel, then renders the game.
 *
 * On a host that serves headers the CSP `frame-ancestors` directive is the real gate; this is
 * the fallback for the static host that serves none (#2481), and the home of the message
 * receiver either way. If a non-allowlisted origin has framed us, the board is replaced with a
 * link out to the game rather than played inside a stranger's page.
 */
export function EmbedFrame({ slug, gameName, backlinkHref }: EmbedFrameProps) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const win = window as unknown as FrameWindow;
    const decision = checkFrame(win, EMBED_ALLOWED_ORIGINS);
    if (!decision.allowed) {
      setBlocked(true);
      return;
    }

    const selfOrigin = window.location.origin;
    const poster = window as unknown as EmbedPoster;

    const onMessage = (event: MessageEvent) => {
      receiveEmbedMessage(
        { origin: event.origin, data: event.data },
        {
          allowlist: EMBED_ALLOWED_ORIGINS,
          selfOrigin,
          onMessage: (message, origin) => {
            // A ping is answered so an embedder can confirm the channel is live. The reply is
            // aimed at the verified origin the message came from — never '*', never
            // `event.source`. `pause`/`resume`/`setMuted` are validated and delivered here;
            // wiring them into the running match belongs to PlaySurface's own controls, which
            // this route does not own.
            if (message.type === 'ping') {
              postToEmbedder(poster, { channel: EMBED_CHANNEL, type: 'pong', nonce: message.nonce }, origin);
            }
          },
        },
      );
    };

    window.addEventListener('message', onMessage);
    // Announce readiness to an allowlisted embedder, at its specific origin.
    if (decision.ancestorOrigin !== null) {
      postToEmbedder(poster, { channel: EMBED_CHANNEL, type: 'ready' }, decision.ancestorOrigin);
    }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (blocked) {
    return (
      <div className={styles.blocked}>
        <p>This DuelBox game cannot be embedded here.</p>
        <a href={backlinkHref} target="_blank" rel="noopener noreferrer">
          {embedBacklinkLabel(gameName)}
        </a>
      </div>
    );
  }

  return <PlaySurface slug={slug} />;
}
