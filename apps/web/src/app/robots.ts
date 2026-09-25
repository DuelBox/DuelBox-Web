import type { MetadataRoute } from 'next';
import { absoluteUrl } from '../lib/site';

/**
 * Declared static, because Next will not assume it. Under `output: 'export'` a metadata
 * route is compiled as a route handler, and the build refuses one that has not said whether
 * it renders once or per request — it fails collecting page data for `/robots.txt` rather
 * than guess. Rendered at build and served as a file is the only answer a static export can
 * give, and it is the answer `check-zero-cost` exists to protect.
 */
export const dynamic = 'force-static';

/**
 * `/robots.txt`: everything may be crawled, and here is the sitemap.
 *
 * Generated beside the sitemap rather than dropped into `public/`, because the one line
 * that matters — the sitemap's address — depends on where the site is deployed, and that
 * is only known at build time. There is nothing to disallow: no admin, no API, no search
 * results page, and every route is meant to be found.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
