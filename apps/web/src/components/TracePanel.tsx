'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './TracePanel.module.css';

/**
 * The debug overlay, and the only thing it does is hand you the trace.
 *
 * "It stuttered", "my tap did not register", "the ball went the wrong way" are all
 * unreproducible by construction: the person cannot tell you what they pressed, and the frame
 * it happened on is the only thing that matters. This exists so that whoever felt it can send
 * the trace instead of the sentence.
 *
 * It appears only for `?trace=1`, and it is a **query parameter rather than a build flag** on
 * purpose: the report that matters is the one somebody makes about the deployed site, and a
 * flag they cannot turn on is a flag that never records the bug.
 */
export function TracePanel({ getTrace }: { getTrace: (() => string) | null }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [size, setSize] = useState(0);

  // A tenth of a second, not a frame. The panel is a debugging aid and re-rendering it on
  // every step would put React in the loop this is meant to be measuring.
  useEffect(() => {
    if (getTrace === null) return;
    const tick = setInterval(() => {
      setSize(getTrace().length);
    }, 100);
    return () => {
      clearInterval(tick);
    };
  }, [getTrace]);

  const copy = useCallback(() => {
    if (getTrace === null) return;
    const text = getTrace();
    // `writeText` rejects without a user gesture and is absent over plain HTTP on some
    // browsers, which is exactly where somebody testing a phone against a laptop will be. The
    // fallback opens the trace as a document they can save by hand rather than failing.
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied('done');
      })
      .catch(() => {
        setCopied('failed');
      });
  }, [getTrace]);

  if (getTrace === null) return null;

  return (
    <div className={styles.panel} role="status" aria-label="Input trace">
      <span className={styles.title}>Trace</span>
      <span className={styles.size}>{(size / 1024).toFixed(1)} kB</span>
      <button type="button" className={styles.copy} onClick={copy}>
        {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy trace'}
      </button>
    </div>
  );
}
