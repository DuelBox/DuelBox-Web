import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Offline',
  description: 'This page has not been saved to this device yet.',
};

/**
 * What the service worker serves for a route this device has never opened, with no
 * connection.
 *
 * It exists so the honest answer is a sentence rather than the browser's dinosaur. The
 * whole shell and every game already played are on the device; this one game is not, and
 * saying which is which is the point — `docs/pwa.md` explains why the 108 game chunks are
 * cached on play rather than downloaded up front.
 *
 * A plain page on purpose. It is served while the network is gone, so it must not depend on
 * anything that is not already in the precache: no images, no fonts beyond the shell's own,
 * no data.
 */
export default function OfflinePage() {
  return (
    <div className="db-wrap">
      <h1>Not saved to this device</h1>
      <p>
        You are offline, and this is a page your browser has not kept. Everything you have already
        opened is still here.
      </p>
      <p>
        <Link href="/games/">Games you can play offline</Link>
      </p>
      <p>
        Games are saved as you play them, rather than all hundred and eight downloaded up front.
        Open this one once with a connection and it will work without one afterwards.
      </p>
    </div>
  );
}
