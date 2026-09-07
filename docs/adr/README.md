# Architecture decision records

One file per decision, numbered in the order they were recorded. An accepted record is
never edited except to mark it superseded; see `template.md` for the format and the rule.

| ADR                                                     | Decision                                                                            | Status   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| [0001](0001-static-first-hosting.md)                    | The browser does the computing; the origin only ever serves files                   | accepted |
| [0002](0002-nextjs-app-router-static-export.md)         | Next.js 15 App Router with `output: 'export'`, over a Vite SPA or Astro             | accepted |
| [0003](0003-canvas2d-behind-renderer-interface.md)      | Canvas2D behind the `Renderer` interface, in logical units; WebGL deferred          | accepted |
| [0004](0004-fixed-timestep-seeded-rng-logical-units.md) | Fixed 60 Hz timestep, seeded `Rng`, no wall clock or device reads in the simulation | accepted |
