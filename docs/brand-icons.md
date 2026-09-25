# Brand icons and the web manifest (#73)

The DuelBox mark and the icon set built from it, and where each file is wired.

## The mark

A neutral, original geometric form: a rounded square is the **box** two people share, a
diagonal **seam** splits it in two, and a **pip** sits in each half — a disc on one side and
a rounded square on the other, so the two seats read apart by shape and not only by position
(rule 7). It is one indigo (`#4b3beb`, the brand token) on white.

It is deliberately **not** tied to the unmade brand identity (#2322). The seam is a
candidate there; this is a placeholder chosen to be clean at 16px and easy to reskin. All
four files share the same geometry, so a reskin is one shape edited in four small SVGs.

## The files, and what each is for

| File | Convention | Purpose | Notes |
|------|-----------|---------|-------|
| `apps/web/src/app/icon.svg` | Next `icon` | Favicon / tab icon | Rounded square with transparent corners so it sits on any tab colour. Next emits `<link rel="icon">` with the base path. |
| `apps/web/src/app/apple-icon.svg` | Next `apple-icon` | iOS home screen | Full-bleed and opaque — iOS rounds the corners and drops any transparency itself. Next emits `<link rel="apple-touch-icon">`. |
| `apps/web/public/manifest-icon.svg` | referenced by manifest | Install icon, `purpose: any` | Full-bleed, mark at full size, for a square slot. |
| `apps/web/public/manifest-icon-maskable.svg` | referenced by manifest | Install icon, `purpose: maskable` | Mark scaled to 0.6 and centred so it stays inside a launcher's circular/squircle crop; indigo bleeds to every edge. |
| `apps/web/src/app/manifest.ts` | Next `manifest` | `manifest.webmanifest` | Name, description, `display: standalone`, `theme_color #4b3beb`, `background_color #f7f8fc`, and the two icons above. |

## Sizes

Every icon is **SVG**, so one file serves every resolution rather than a ladder of PNGs:

- **Favicon** — SVG; browsers rasterise it to 16/32/48 as needed. A rounded-square mark that
  stays legible at 16px is why the mark is this simple.
- **apple-touch-icon** — SVG at the standard **180×180** viewport (the `viewBox` is 64 units,
  scaled by the browser); iOS accepts SVG and masks it.
- **Manifest `any`** — SVG, `sizes: "any"`. Covers the 192 and 512 slots install prompts ask
  for without shipping two raster files.
- **Manifest `maskable`** — SVG, `sizes: "any"`, mark inside the ~40%-radius safe zone.

If a future host or store rejects SVG icons (a few still want raster), rasterise
`manifest-icon.svg` to `192×192` and `512×512` PNGs and add them to the manifest beside the
SVG; the mark is vector, so the export is lossless. That is the only reason to add raster
files, and it is why none are checked in today.

## Base path

The site can serve from `/<repo>/` on GitHub Pages. Next puts the base path on the icon and
manifest `<link>` tags automatically, but **not** on the icon `src` strings inside the
manifest JSON — so `manifest.ts` joins `NEXT_PUBLIC_BASE_PATH` onto each `src`, and onto
`start_url`/`scope`, or an installed window would open at a root the project page does not
serve. `manifest.test.ts` checks that the base path lands on all three.
