import type { Metadata } from 'next';
import Link from 'next/link';
import { RUNTIME_DEPENDENCIES, FONT_ATTRIBUTIONS } from './attribution-data.generated';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Attribution',
  description:
    'The open-source libraries and fonts DuelBox is built with, and the licences they are used under.',
};

/**
 * The third-party attribution page (#215).
 *
 * A server component, so the generated list is rendered to static HTML and costs the client
 * bundle nothing. The list itself is not maintained here — `scripts/emit-attribution.mjs`
 * composes `attribution-data.generated.ts` from the shipped dependencies and the OFL font
 * record, and a stale copy fails `pnpm check:attribution` and `attribution.generated.test.ts`.
 */
export default function AttributionPage() {
  return (
    <div className="db-wrap">
      <header className={styles.head}>
        <h1>Attribution</h1>
        <p className={styles.updated}>Generated from the shipped dependencies and font licences.</p>
      </header>

      <div className={styles.prose}>
        <p className={styles.lead}>
          DuelBox is built with a small number of open-source libraries and fonts. This page lists
          them and the licences they are used under. It is generated, not written by hand, so it
          cannot drift from what actually ships.
        </p>

        <h2>Libraries</h2>
        <p>
          The runtime dependencies bundled into the site, with the resolved version and licence of
          each.
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Library</th>
                <th scope="col">Version</th>
                <th scope="col">Licence</th>
              </tr>
            </thead>
            <tbody>
              {RUNTIME_DEPENDENCIES.map((dep) => (
                <tr key={dep.name}>
                  <td>
                    {dep.homepage ? (
                      <a href={dep.homepage} rel="noopener noreferrer" target="_blank">
                        {dep.name}
                      </a>
                    ) : (
                      dep.name
                    )}
                  </td>
                  <td>{dep.version}</td>
                  <td>{dep.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2>Fonts</h2>
        <p>
          Three typefaces, all variable fonts served from this origin under the SIL Open Font
          Licence. The full licence text ships with the site in{' '}
          <code>src/styles/fonts/OFL.txt</code>.
        </p>
        <ul className={styles.fonts}>
          {FONT_ATTRIBUTIONS.map((font) => (
            <li key={font.family}>
              <strong>{font.family}</strong> — {font.author}.{' '}
              <a href={font.licenceUrl} rel="noopener noreferrer" target="_blank">
                {font.licence}
              </a>
            </li>
          ))}
        </ul>

        <h2>Our own work</h2>
        <p>
          Everything else — the game code, the artwork, the sounds and the names — is original to
          DuelBox and covered by this repository&apos;s licence. See{' '}
          <Link href="/terms/">Terms of use</Link> for what that means for you.
        </p>
      </div>
    </div>
  );
}
