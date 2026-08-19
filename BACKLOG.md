# DuelBox backlog — 1859 issues

## Issues per milestone

- **M0 Foundation** — 57
- **M1 Playable Shell** — 130
- **M2 Game Catalog** — 1574
- **M3 Premium Site** — 57
- **M4 Online** — 15
- **(none)** — 1

## Platform and website issues


### Repo, tooling and CI (13)

- #50 Initialise Next.js 15 app with TypeScript and the App Router  
  `priority:P0 size:S type:chore`
- #51 Convert the repo to a pnpm workspace monorepo  
  `priority:P0 size:S type:chore`
- #52 Add a shared strict tsconfig base and per-package configs  
  `priority:P0 size:S type:chore`
- #53 Add ESLint and Prettier with one pnpm lint entry point  
  `priority:P1 size:XS type:chore`
- #54 Add a custom ESLint rule banning Math.random inside game packages  
  `priority:P1 size:XS type:chore`
- #58 Build the CI pipeline: install, lint, typecheck, test, build  
  `priority:P0 size:M type:chore`
- #60 Add issue templates and a pull request template  
  `priority:P2 size:XS type:chore`
- #61 Add CODEOWNERS and protect the main branch  
  `priority:P2 size:XS type:chore`
- #62 Add secret scanning and dependency vulnerability scanning  
  `priority:P1 size:S type:chore`
- #63 Add Dependabot with grouped weekly updates  
  `priority:P3 size:XS type:chore`
- #64 Set up Vercel preview deployments per pull request  
  `priority:P1 size:S type:chore`
- #75 Set up Storybook for the UI package  
  `priority:P2 size:M type:chore`
- #218 Add security headers  
  `priority:P3 size:XS type:chore`

### Design system (4)

- #68 Define the colour token set including the P1/P2 player pair  
  `priority:P0 size:M type:spec`
- #69 Define the type scale and load the display, body, and mono faces  
  `priority:P1 size:M type:spec`
- #70 Define the spacing, radius, elevation, and z-index scales  
  `priority:P1 size:S type:spec`
- #71 Configure Tailwind v4 to consume the design tokens  
  `priority:P1 size:S type:chore`

### Website shell and routes (5)

- #78 Build the site header with logo, navigation, and mode toggle  
  `priority:P1 size:M type:feat`
- #79 Build the site footer with legal, about, and language links  
  `priority:P3 size:XS type:feat`
- #84 Add category filter chips to the catalog  
  `priority:P2 size:M type:feat`
- #85 Add sort controls for the catalog  
  `priority:P3 size:S type:feat`
- #92 Build the 404 and error routes  
  `priority:P2 size:S type:feat`

### 3D landing experience (7)

- #95 Spec the 3D landing experience and its hard performance budget  
  `priority:P1 size:M type:spec`
- #96 Set up React Three Fiber isolated to the landing route  
  `priority:P2 size:M type:feat`
- #97 Model and light the hero scene  
  `priority:P2 size:L type:feat`
- #98 Implement scroll-driven camera choreography without scroll-jacking  
  `priority:P2 size:M type:feat`
- #99 Implement device capability detection and the static hero fallback  
  `priority:P1 size:M type:feat`
- #100 Optimise 3D assets with Draco and KTX2  
  `priority:P2 size:M type:chore`
- #101 Handle WebGL context loss and restoration  
  `priority:P2 size:S type:bug`

### Game engine core (38)

- #14 Implement fixed-timestep game loop with interpolated rendering  
  `type:feat`
- #15 Implement scene graph with transform hierarchy  
  `type:feat`
- #16 Build a 2D renderer abstraction over Canvas2D with a WebGL path  
  `type:feat`
- #17 Implement sprite atlas loader and texture packing at build time  
  `type:feat`
- #18 Implement 2D collision primitives: circle, AABB, OBB, segment  
  `type:feat`
- #19 Implement impulse-based collision resolution with restitution and friction  
  `type:feat`
- #20 Implement continuous collision detection for fast projectiles  
  `type:feat`
- #21 Implement spatial hash broadphase  
  `type:feat`
- #22 Implement seeded deterministic RNG  
  `type:feat`
- #23 Implement particle system with pooling  
  `type:feat`
- #24 Implement tween/easing library for UI and game juice  
  `type:feat`
- #25 Implement screen shake, hit-stop, and flash as reusable juice primitives  
  `type:feat`
- #26 Implement asset preloader with progress events  
  `type:feat`
- #27 Implement pause/resume/visibility handling  
  `type:feat`
- #28 Implement a debug overlay: FPS, step time, body count, input state  
  `type:chore`
- #29 Implement input recording and replay for deterministic bug reports  
  `type:feat`
- #30 Implement responsive canvas sizing with letterboxing and safe areas  
  `type:feat`
- #31 Add DPR-aware rendering with a cap  
  `type:feat`
- #104 Implement the fixed-timestep game loop with interpolated rendering  
  `priority:P0 size:L type:feat`
- #105 Implement the seeded deterministic RNG  
  `priority:P0 size:S type:feat`
- #106 Implement the vector and matrix math module with pooled scratch objects  
  `priority:P0 size:M type:feat`
- #107 Implement the canvas renderer abstraction  
  `priority:P0 size:L type:feat`
- #108 Add device-pixel-ratio aware rendering with a cap  
  `priority:P1 size:M type:feat`
- #109 Implement the seat and rotation system for two players sharing one screen  
  `priority:P0 size:L type:feat`
- #110 Implement collision primitives: circle, AABB, OBB, and segment  
  `priority:P0 size:L type:feat`
- #111 Implement continuous collision detection for fast bodies  
  `priority:P1 size:M type:feat`
- #112 Implement the spatial hash broadphase  
  `priority:P2 size:M type:feat`
- #113 Implement the tween and easing library  
  `priority:P1 size:M type:feat`
- #114 Implement juice primitives: screen shake, hit-stop, and flash  
  `priority:P1 size:M type:feat`
- #115 Implement the particle system with object pooling  
  `priority:P2 size:M type:feat`
- #116 Implement the asset loader with progress reporting  
  `priority:P1 size:M type:feat`
- #117 Implement sprite atlas packing at build time  
  `priority:P2 size:M type:feat`
- #118 Implement pause, resume, and visibility handling  
  `priority:P0 size:S type:feat`
- #119 Implement the debug overlay  
  `priority:P2 size:S type:chore`
- #120 Implement input recording and deterministic replay  
  `priority:P2 size:M type:feat`
- #121 Implement adaptive quality scaling  
  `priority:P2 size:M type:feat`
- #122 Eliminate per-frame allocations across the engine hot path  
  `priority:P2 size:M type:chore`
- #240 Implement deterministic lockstep with input delay  
  `priority:P3 size:L type:feat`

### Two-player input system (29)

- #32 Design the multi-input abstraction covering touch, keyboard, and gamepad  
  `type:spec`
- #33 Implement multi-touch tracking with per-player zone ownership  
  `type:feat`
- #34 Implement keyboard binding map with default P1/P2 split  
  `type:feat`
- #35 Implement keyboard rebinding UI with conflict detection  
  `type:feat`
- #36 Implement Gamepad API support with player-index assignment  
  `type:feat`
- #37 Implement input latency measurement harness  
  `type:feat`
- #38 Prevent browser default gestures that break gameplay  
  `type:bug`
- #39 Implement rotate-device prompt for landscape-only games  
  `type:feat`
- #40 Implement pass-and-play hand-off screen for hidden-information games  
  `type:feat`
- #41 Implement haptic feedback via the Vibration API with a global toggle  
  `type:feat`
- #42 Handle simultaneous-input tie resolution policy  
  `type:spec`
- #43 Add on-screen touch control hints that fade after first successful input  
  `type:feat`
- #123 Write the two-player input design document  
  `priority:P0 size:M type:spec`
- #124 Implement the normalised input state structure  
  `priority:P0 size:M type:feat`
- #125 Implement multi-touch tracking with per-seat zone ownership  
  `priority:P0 size:L type:feat`
- #126 Implement drag-to-aim gesture recognition  
  `priority:P1 size:M type:feat`
- #127 Implement tap, hold, and charge gesture recognition  
  `priority:P1 size:M type:feat`
- #128 Implement the keyboard binding map with a default P1/P2 split  
  `priority:P0 size:M type:feat`
- #129 Build the keyboard rebinding interface with conflict detection  
  `priority:P2 size:M type:feat`
- #130 Implement Gamepad API support with seat assignment  
  `priority:P2 size:M type:feat`
- #131 Prevent browser default gestures that sabotage touch gameplay  
  `priority:P0 size:M type:bug`
- #132 Define and implement the same-frame input tie policy  
  `priority:P1 size:S type:spec`
- #133 Build the input latency measurement harness  
  `priority:P2 size:M type:feat`
- #134 Implement the pass-and-play hand-off screen  
  `priority:P2 size:M type:feat`
- #135 Implement haptic feedback with a global toggle  
  `priority:P3 size:XS type:feat`
- #136 Implement the rotate-device prompt for landscape-only games  
  `priority:P2 size:S type:feat`
- #137 Add on-screen control hints that fade after the first successful input  
  `priority:P2 size:S type:feat`
- #231 Add input fuzz testing  
  `priority:P3 size:M type:feat`
- #1754 Implement hold-to-act input with a release constraint  
  `priority:P2 size:S type:feat`

### Game SDK and match flow (30)

- #44 Define the Game module contract  
  `type:spec`
- #45 Define the GameMeta manifest schema  
  `type:feat`
- #46 Implement game lifecycle host in the shell  
  `type:feat`
- #47 Implement the standard match flow: countdown, play, result, rematch  
  `type:feat`
- #48 Implement the shared scoreboard HUD component  
  `type:feat`
- #49 Implement a difficulty interface for AI opponents  
  `type:spec`
- #90 Build the play route that hosts the game canvas  
  `priority:P0 size:M type:feat`
- #138 Define and validate the GameMeta manifest schema  
  `priority:P0 size:M type:feat`
- #139 Build the game registry with lazy chunk loading  
  `priority:P0 size:M type:feat`
- #140 Implement the game lifecycle host  
  `priority:P0 size:L type:feat`
- #141 Implement the match state machine  
  `priority:P0 size:L type:feat`
- #142 Build the pre-match countdown  
  `priority:P1 size:S type:feat`
- #143 Build the shared scoreboard HUD  
  `priority:P0 size:M type:feat`
- #144 Build the in-match exit control and quit confirmation  
  `priority:P1 size:S type:feat`
- #145 Build the pause menu  
  `priority:P1 size:S type:feat`
- #146 Build the turn indicator and seat flip animation  
  `priority:P0 size:M type:feat`
- #147 Build the result screen with rematch and next-game actions  
  `priority:P0 size:M type:feat`
- #148 Define the win-condition helper library  
  `priority:P1 size:M type:feat`
- #149 Implement the match timer and round clock  
  `priority:P1 size:S type:feat`
- #150 Define the bot difficulty interface  
  `priority:P1 size:M type:spec`
- #151 Implement the game error boundary with recovery  
  `priority:P1 size:M type:feat`
- #152 Implement per-game settings persistence  
  `priority:P2 size:S type:feat`
- #153 Build the create-game CLI scaffold  
  `priority:P0 size:M type:feat`
- #154 Build the headless AI-vs-AI balance harness  
  `priority:P2 size:L type:feat`
- #155 Implement the asset licence manifest and its CI check  
  `priority:P1 size:M type:feat`
- #1749 Implement play-mode declaration and mode-aware lobby buttons  
  `priority:P1 size:S type:feat`
- #1750 Implement solo score-attack mode in the match flow  
  `priority:P2 size:M type:feat`
- #1751 Build the per-game options panel  
  `priority:P2 size:M type:feat`
- #1752 Add health and accumulated-score win conditions to the helper library  
  `priority:P1 size:S type:feat`
- #1753 Build the health bar HUD component  
  `priority:P2 size:S type:feat`

### Tournament and progression (12)

- #86 Implement a favourites list stored locally  
  `priority:P2 size:M type:feat`
- #87 Implement a recently played row  
  `priority:P3 size:S type:feat`
- #156 Design the tournament mode  
  `priority:P1 size:S type:spec`
- #157 Implement the tournament state machine with resumable progress  
  `priority:P1 size:M type:feat`
- #158 Build the tournament progress track UI  
  `priority:P1 size:M type:feat`
- #159 Implement random game selection for tournaments  
  `priority:P1 size:S type:feat`
- #160 Implement the persistent head-to-head record  
  `priority:P1 size:S type:feat`
- #161 Implement player names and colour assignment  
  `priority:P2 size:M type:feat`
- #162 Implement per-game statistics  
  `priority:P3 size:M type:feat`
- #163 Implement the quick-play random game action  
  `priority:P3 size:XS type:feat`
- #164 Implement the post-match share card generator  
  `priority:P3 size:M type:feat`
- #165 Implement the idle attract mode  
  `priority:P3 size:M type:feat`

### Audio (8)

- #166 Implement the Web Audio engine with a pooled source graph  
  `priority:P1 size:M type:feat`
- #167 Handle the autoplay policy and first-gesture audio unlock  
  `priority:P1 size:S type:bug`
- #168 Define the shared sound event vocabulary  
  `priority:P1 size:S type:spec`
- #169 Produce the original core sound effect set  
  `priority:P2 size:L type:chore`
- #170 Encode audio to Opus with an AAC fallback  
  `priority:P2 size:S type:chore`
- #171 Implement volume controls and a persistent global mute  
  `priority:P2 size:S type:feat`
- #172 Implement audio ducking for countdowns and announcements  
  `priority:P3 size:XS type:feat`
- #173 Commission original menu and match music  
  `priority:P3 size:L type:chore`

### Accessibility (17)

- #72 Define the motion system: durations, easings, and the reduced-motion policy  
  `priority:P1 size:M type:spec`
- #76 Implement dark and light themes with a persisted user override  
  `priority:P2 size:M type:feat`
- #77 Build the root layout with header, main region, and footer  
  `priority:P0 size:S type:feat`
- #83 Add catalog search with debounced client-side filtering  
  `priority:P1 size:M type:feat`
- #89 Build the how-to-play panel with a controls diagram per input device  
  `priority:P1 size:M type:feat`
- #91 Build the settings page  
  `priority:P2 size:M type:feat`
- #94 Implement page transitions that never delay interactivity  
  `priority:P3 size:M type:feat`
- #103 Guarantee the landing page works fully with JavaScript disabled  
  `priority:P1 size:M type:feat`
- #174 Implement colour-blind safe player differentiation  
  `priority:P1 size:M type:feat`
- #175 Implement prefers-reduced-motion across shell and games  
  `priority:P1 size:M type:feat`
- #176 Ensure full keyboard navigation with a visible focus ring  
  `priority:P1 size:M type:feat`
- #177 Add screen reader support for shell navigation and match results  
  `priority:P2 size:M type:feat`
- #178 Enforce minimum touch target sizes  
  `priority:P2 size:S type:feat`
- #179 Add an assist mode with adjustable game speed  
  `priority:P3 size:M type:feat`
- #180 Add visual indicators for every audio-only cue  
  `priority:P2 size:M type:feat`
- #181 Add axe-core accessibility checks to CI  
  `priority:P2 size:S type:chore`
- #182 Run a WCAG 2.2 AA audit and file the defects  
  `priority:P2 size:L type:qa`

### Performance (15)

- #59 Add a bundle-size budget check with size-limit  
  `priority:P1 size:M type:chore`
- #74 Build the icon set as an optimised sprite  
  `priority:P2 size:M type:feat`
- #82 Build the game card component with static and animated states  
  `priority:P1 size:M type:feat`
- #93 Add route-level loading skeletons  
  `priority:P2 size:S type:feat`
- #183 Define and document the performance budgets  
  `priority:P1 size:S type:spec`
- #184 Add Lighthouse CI against preview deployments  
  `priority:P2 size:M type:chore`
- #185 Implement route and game chunk prefetching on intent  
  `priority:P2 size:M type:feat`
- #186 Build the image optimisation pipeline  
  `priority:P2 size:M type:chore`
- #187 Optimise font loading  
  `priority:P2 size:S type:chore`
- #188 Configure CDN caching and immutable asset headers  
  `priority:P2 size:S type:chore`
- #189 Set up low-end Android device testing  
  `priority:P2 size:L type:qa`
- #190 Add battery and thermal awareness  
  `priority:P3 size:M type:feat`
- #207 Add real user monitoring for Core Web Vitals  
  `priority:P3 size:S type:feat`
- #224 Ensure fonts cover every launch locale's glyphs  
  `priority:P3 size:S type:chore`
- #232 Add the memory leak soak test to CI  
  `priority:P2 size:M type:feat`

### Offline and installability (6)

- #191 Add the web app manifest with maskable icons and shortcuts  
  `priority:P2 size:S type:feat`
- #192 Implement the service worker with a strategy per asset class  
  `priority:P2 size:L type:feat`
- #193 Build the offline indicator and offline-aware catalog  
  `priority:P2 size:M type:feat`
- #194 Implement the service worker update prompt  
  `priority:P2 size:M type:feat`
- #195 Add a custom install prompt with correct timing  
  `priority:P3 size:S type:feat`
- #196 Add a download-all-games action with a storage quota strategy  
  `priority:P3 size:M type:feat`

### Discovery and SEO (9)

- #80 Define the URL and route structure for the whole site  
  `priority:P0 size:S type:spec`
- #81 Build the game catalog grid page  
  `priority:P0 size:M type:feat`
- #88 Build the per-game landing page  
  `priority:P0 size:M type:feat`
- #102 Build the landing page content sections below the hero  
  `priority:P1 size:M type:feat`
- #197 Implement per-route metadata, Open Graph, and Twitter cards  
  `priority:P2 size:M type:feat`
- #198 Add VideoGame structured data to every game page  
  `priority:P3 size:S type:feat`
- #199 Generate sitemap.xml and robots.txt at build time  
  `priority:P3 size:XS type:chore`
- #200 Build category hub pages targeting real search intent  
  `priority:P3 size:M type:feat`
- #201 Implement canonical URLs and hreflang for localised routes  
  `priority:P3 size:S type:feat`

### Backend and data (7)

- #202 Build the embeddable game iframe with attribution  
  `priority:P3 size:M type:feat`
- #209 Set up error tracking with source maps  
  `priority:P2 size:S type:chore`
- #235 Implement staged rollout with automatic rollback  
  `priority:P3 size:M type:feat`
- #238 Implement the WebSocket room server  
  `priority:P3 size:L type:feat`
- #243 Implement server-side score validation and anti-cheat  
  `priority:P3 size:L type:feat`
- #244 Implement global leaderboards per game  
  `priority:P3 size:M type:feat`
- #246 Implement optional accounts with local progress migration  
  `priority:P3 size:L type:feat`

### Analytics (5)

- #203 Define the analytics event taxonomy before instrumenting anything  
  `priority:P2 size:M type:spec`
- #204 Implement privacy-preserving analytics  
  `priority:P2 size:M type:feat`
- #205 Instrument the core funnel  
  `priority:P3 size:M type:feat`
- #206 Instrument per-game engagement and early abandonment  
  `priority:P3 size:M type:feat`
- #208 Implement a feature flag system with a per-game kill switch  
  `priority:P3 size:M type:feat`

### Legal and compliance (11)

- #66 Write CONTRIBUTING.md including the research scope boundary  
  `priority:P2 size:S type:chore`
- #73 Design the brand identity: name treatment, logo, and favicon set  
  `priority:P2 size:M type:feat`
- #210 Complete an IP clearance review of every game name  
  `priority:P1 size:L type:spec`
- #211 Write and enforce the asset provenance policy  
  `priority:P1 size:S type:chore`
- #212 Write the privacy policy  
  `priority:P2 size:M type:chore`
- #213 Write the terms of service  
  `priority:P2 size:M type:chore`
- #214 Decide the child-audience position and implement the controls  
  `priority:P1 size:M type:spec`
- #215 Add the third-party attribution page  
  `priority:P3 size:XS type:chore`
- #216 Publish a DMCA and abuse contact process  
  `priority:P3 size:XS type:chore`
- #217 Configure a strict Content Security Policy  
  `priority:P2 size:M type:chore`
- #245 Implement reporting, name filtering, and a moderation queue  
  `priority:P3 size:M type:feat`

### Internationalisation (5)

- #219 Implement the i18n framework with lazy locale bundles  
  `priority:P2 size:M type:feat`
- #220 Extract every user-facing string into locale files  
  `priority:P2 size:L type:chore`
- #221 Translate the launch locale set  
  `priority:P3 size:L type:chore`
- #222 Implement RTL layout support  
  `priority:P3 size:M type:feat`
- #223 Verify text expansion does not break layouts  
  `priority:P3 size:S type:qa`

### Testing and QA (12)

- #55 Set up Vitest with jsdom and a canvas mock  
  `priority:P0 size:S type:chore`
- #56 Add a Vitest coverage gate for engine and rules modules  
  `priority:P2 size:S type:chore`
- #57 Add Playwright with Chromium, Firefox, and WebKit projects  
  `priority:P1 size:S type:chore`
- #225 Define the browser and device support matrix  
  `priority:P2 size:S type:spec`
- #226 Write end-to-end tests for the core journeys  
  `priority:P1 size:M type:feat`
- #227 Add visual regression testing for shell screens  
  `priority:P3 size:M type:chore`
- #228 Build the manual playtest protocol and score sheet  
  `priority:P2 size:S type:spec`
- #229 Run moderated playtests with real pairs  
  `priority:P2 size:L type:qa`
- #230 Run a dedicated iOS Safari divergence pass  
  `priority:P1 size:M type:qa`
- #233 Add an in-app bug report link with prefilled context  
  `priority:P3 size:S type:feat`
- #234 Establish and run the pre-launch checklist  
  `priority:P2 size:S type:chore`
- #247 Load test the room server  
  `priority:P3 size:M type:chore`

### Online multiplayer (4)

- #237 Spec online multiplayer scope and per-game suitability  
  `priority:P3 size:M type:spec`
- #239 Implement WebRTC data channels with a TURN fallback  
  `priority:P3 size:L type:feat`
- #241 Implement invite links and private rooms  
  `priority:P3 size:M type:feat`
- #242 Implement disconnect handling and reconnect grace  
  `priority:P3 size:M type:feat`

### Documentation (4)

- #13 Write CONTRIBUTING.md with the 'how to add a game' walkthrough  
  `type:chore`
- #65 Write the repo README and architecture overview  
  `priority:P2 size:S type:chore`
- #67 Add an ADR template and record the first three decisions  
  `priority:P2 size:S type:spec`
- #236 Write the release and rollback runbook  
  `priority:P3 size:S type:chore`

## Per-game issues (1606 across 108 games)


### air-hockey (15)

- #818 [Air Hockey] Build the game
- #819 [Air Hockey] Research: play the reference genre and document observed mechanics
- #820 [Air Hockey] Write the game spec
- #821 [Air Hockey] Scaffold the game package and manifest
- #822 [Air Hockey] Implement the state model and rules module
- #823 [Air Hockey] Wire up controls for both seats
- #824 [Air Hockey] Implement the core simulation
- #825 [Air Hockey] Implement scoring and the win condition
- #826 [Air Hockey] Implement rendering
- #827 [Air Hockey] Implement the split-seat layout and per-seat HUD placement
- #828 [Air Hockey] Integrate the shared match flow
- #829 [Air Hockey] Implement the bot opponent with three difficulty tiers
- #830 [Air Hockey] Create original art and wire the audio events
- #831 [Air Hockey] Write unit and deterministic simulation tests
- #832 [Air Hockey] QA pass against the definition of done

### animal-stack (15)

- #1253 [Animal Stack] Build the game
- #1254 [Animal Stack] Research: play the reference genre and document observed mechanics
- #1255 [Animal Stack] Write the game spec
- #1256 [Animal Stack] Scaffold the game package and manifest
- #1257 [Animal Stack] Implement the state model and rules module
- #1258 [Animal Stack] Wire up controls for both seats
- #1259 [Animal Stack] Implement the core simulation
- #1260 [Animal Stack] Implement scoring and the win condition
- #1261 [Animal Stack] Implement rendering
- #1262 [Animal Stack] Implement the split-seat layout and per-seat HUD placement
- #1263 [Animal Stack] Integrate the shared match flow
- #1264 [Animal Stack] Implement the bot opponent with three difficulty tiers
- #1265 [Animal Stack] Create original art and wire the audio events
- #1266 [Animal Stack] Write unit and deterministic simulation tests
- #1267 [Animal Stack] QA pass against the definition of done

### archery (15)

- #713 [Archery] Build the game
- #714 [Archery] Research: play the reference genre and document observed mechanics
- #715 [Archery] Write the game spec
- #716 [Archery] Scaffold the game package and manifest
- #717 [Archery] Implement the state model and rules module
- #718 [Archery] Wire up controls for both seats
- #719 [Archery] Implement the core simulation
- #720 [Archery] Implement scoring and the win condition
- #721 [Archery] Implement rendering
- #722 [Archery] Integrate seat rotation and the turn indicator
- #723 [Archery] Integrate the shared match flow
- #724 [Archery] Implement the bot opponent with three difficulty tiers
- #725 [Archery] Create original art and wire the audio events
- #726 [Archery] Write unit and deterministic simulation tests
- #727 [Archery] QA pass against the definition of done

### archery-master (15)

- #728 [Archery Master] Build the game
- #729 [Archery Master] Research: play the reference genre and document observed mechanics
- #730 [Archery Master] Write the game spec
- #731 [Archery Master] Scaffold the game package and manifest
- #732 [Archery Master] Implement the state model and rules module
- #733 [Archery Master] Wire up controls for both seats
- #734 [Archery Master] Implement the core simulation
- #735 [Archery Master] Implement scoring and the win condition
- #736 [Archery Master] Implement rendering
- #737 [Archery Master] Integrate seat rotation and the turn indicator
- #738 [Archery Master] Integrate the shared match flow
- #739 [Archery Master] Implement the bot opponent with three difficulty tiers
- #740 [Archery Master] Create original art and wire the audio events
- #741 [Archery Master] Write unit and deterministic simulation tests
- #742 [Archery Master] QA pass against the definition of done

### backgammon (15)

- #383 [Backgammon] Build the game
- #384 [Backgammon] Research: play the reference genre and document observed mechanics
- #385 [Backgammon] Write the game spec
- #386 [Backgammon] Scaffold the game package and manifest
- #387 [Backgammon] Implement the state model and rules module
- #388 [Backgammon] Wire up controls for both seats
- #389 [Backgammon] Implement the core simulation
- #390 [Backgammon] Implement scoring and the win condition
- #391 [Backgammon] Implement rendering
- #392 [Backgammon] Integrate seat rotation and the turn indicator
- #393 [Backgammon] Integrate the shared match flow
- #394 [Backgammon] Implement the bot opponent with three difficulty tiers
- #395 [Backgammon] Create original art and wire the audio events
- #396 [Backgammon] Write unit and deterministic simulation tests
- #397 [Backgammon] QA pass against the definition of done

### ballgames-physics (15)

- #893 [Ball Games] Build the game
- #894 [Ball Games] Research: play the reference genre and document observed mechanics
- #895 [Ball Games] Write the game spec
- #896 [Ball Games] Scaffold the game package and manifest
- #897 [Ball Games] Implement the state model and rules module
- #898 [Ball Games] Wire up controls for both seats
- #899 [Ball Games] Implement the core simulation
- #900 [Ball Games] Implement scoring and the win condition
- #901 [Ball Games] Implement rendering
- #902 [Ball Games] Implement the split-seat layout and per-seat HUD placement
- #903 [Ball Games] Integrate the shared match flow
- #904 [Ball Games] Implement the bot opponent with three difficulty tiers
- #905 [Ball Games] Create original art and wire the audio events
- #906 [Ball Games] Write unit and deterministic simulation tests
- #907 [Ball Games] QA pass against the definition of done

### basketball (15)

- #638 [Basketball] Build the game
- #639 [Basketball] Research: play the reference genre and document observed mechanics
- #640 [Basketball] Write the game spec
- #641 [Basketball] Scaffold the game package and manifest
- #642 [Basketball] Implement the state model and rules module
- #643 [Basketball] Wire up controls for both seats
- #644 [Basketball] Implement the core simulation
- #645 [Basketball] Implement scoring and the win condition
- #646 [Basketball] Implement rendering
- #647 [Basketball] Integrate seat rotation and the turn indicator
- #648 [Basketball] Integrate the shared match flow
- #649 [Basketball] Implement the bot opponent with three difficulty tiers
- #650 [Basketball] Create original art and wire the audio events
- #651 [Basketball] Write unit and deterministic simulation tests
- #652 [Basketball] QA pass against the definition of done

### beach-ball (15)

- #863 [Beach Ball] Build the game
- #864 [Beach Ball] Research: play the reference genre and document observed mechanics
- #865 [Beach Ball] Write the game spec
- #866 [Beach Ball] Scaffold the game package and manifest
- #867 [Beach Ball] Implement the state model and rules module
- #868 [Beach Ball] Wire up controls for both seats
- #869 [Beach Ball] Implement the core simulation
- #870 [Beach Ball] Implement scoring and the win condition
- #871 [Beach Ball] Implement rendering
- #872 [Beach Ball] Implement the split-seat layout and per-seat HUD placement
- #873 [Beach Ball] Integrate the shared match flow
- #874 [Beach Ball] Implement the bot opponent with three difficulty tiers
- #875 [Beach Ball] Create original art and wire the audio events
- #876 [Beach Ball] Write unit and deterministic simulation tests
- #877 [Beach Ball] QA pass against the definition of done

### blocks (13)

- #1697 [Blocks] Build the game
- #1698 [Blocks] Research: play the reference genre and document observed mechanics
- #1699 [Blocks] Write the game spec
- #1700 [Blocks] Scaffold the game package and manifest
- #1701 [Blocks] Implement the state model and rules module
- #1702 [Blocks] Wire up controls for both seats
- #1703 [Blocks] Implement the core simulation
- #1704 [Blocks] Implement scoring and the win condition
- #1705 [Blocks] Implement rendering
- #1706 [Blocks] Integrate the shared match flow
- #1707 [Blocks] Create original art and wire the audio events
- #1708 [Blocks] Write unit and deterministic simulation tests
- #1709 [Blocks] QA pass against the definition of done

### bowling (15)

- #548 [Bowling] Build the game
- #549 [Bowling] Research: play the reference genre and document observed mechanics
- #550 [Bowling] Write the game spec
- #551 [Bowling] Scaffold the game package and manifest
- #552 [Bowling] Implement the state model and rules module
- #553 [Bowling] Wire up controls for both seats
- #554 [Bowling] Implement the core simulation
- #555 [Bowling] Implement scoring and the win condition
- #556 [Bowling] Implement rendering
- #557 [Bowling] Integrate seat rotation and the turn indicator
- #558 [Bowling] Integrate the shared match flow
- #559 [Bowling] Implement the bot opponent with three difficulty tiers
- #560 [Bowling] Create original art and wire the audio events
- #561 [Bowling] Write unit and deterministic simulation tests
- #562 [Bowling] QA pass against the definition of done

### brainrot-stack (15)

- #1238 [Wobble Stack] Build the game
- #1239 [Wobble Stack] Research: play the reference genre and document observed mechanics
- #1240 [Wobble Stack] Write the game spec
- #1241 [Wobble Stack] Scaffold the game package and manifest
- #1242 [Wobble Stack] Implement the state model and rules module
- #1243 [Wobble Stack] Wire up controls for both seats
- #1244 [Wobble Stack] Implement the core simulation
- #1245 [Wobble Stack] Implement scoring and the win condition
- #1246 [Wobble Stack] Implement rendering
- #1247 [Wobble Stack] Implement the split-seat layout and per-seat HUD placement
- #1248 [Wobble Stack] Integrate the shared match flow
- #1249 [Wobble Stack] Implement the bot opponent with three difficulty tiers
- #1250 [Wobble Stack] Create original art and wire the audio events
- #1251 [Wobble Stack] Write unit and deterministic simulation tests
- #1252 [Wobble Stack] QA pass against the definition of done

### brick-blast (15)

- #1493 [Brick Blast] Build the game
- #1494 [Brick Blast] Research: play the reference genre and document observed mechanics
- #1495 [Brick Blast] Write the game spec
- #1496 [Brick Blast] Scaffold the game package and manifest
- #1497 [Brick Blast] Implement the state model and rules module
- #1498 [Brick Blast] Wire up controls for both seats
- #1499 [Brick Blast] Implement the core simulation
- #1500 [Brick Blast] Implement scoring and the win condition
- #1501 [Brick Blast] Implement rendering
- #1502 [Brick Blast] Implement the split-seat layout and per-seat HUD placement
- #1503 [Brick Blast] Integrate the shared match flow
- #1504 [Brick Blast] Implement the bot opponent with three difficulty tiers
- #1505 [Brick Blast] Create original art and wire the audio events
- #1506 [Brick Blast] Write unit and deterministic simulation tests
- #1507 [Brick Blast] QA pass against the definition of done

### broken-tiles (15)

- #1208 [Broken Tiles] Build the game
- #1209 [Broken Tiles] Research: play the reference genre and document observed mechanics
- #1210 [Broken Tiles] Write the game spec
- #1211 [Broken Tiles] Scaffold the game package and manifest
- #1212 [Broken Tiles] Implement the state model and rules module
- #1213 [Broken Tiles] Wire up controls for both seats
- #1214 [Broken Tiles] Implement the core simulation
- #1215 [Broken Tiles] Implement scoring and the win condition
- #1216 [Broken Tiles] Implement rendering
- #1217 [Broken Tiles] Implement the split-seat layout and per-seat HUD placement
- #1218 [Broken Tiles] Integrate the shared match flow
- #1219 [Broken Tiles] Implement the bot opponent with three difficulty tiers
- #1220 [Broken Tiles] Create original art and wire the audio events
- #1221 [Broken Tiles] Write unit and deterministic simulation tests
- #1222 [Broken Tiles] QA pass against the definition of done

### cannon-duel (15)

- #758 [Cannon Duel] Build the game
- #759 [Cannon Duel] Research: play the reference genre and document observed mechanics
- #760 [Cannon Duel] Write the game spec
- #761 [Cannon Duel] Scaffold the game package and manifest
- #762 [Cannon Duel] Implement the state model and rules module
- #763 [Cannon Duel] Wire up controls for both seats
- #764 [Cannon Duel] Implement the core simulation
- #765 [Cannon Duel] Implement scoring and the win condition
- #766 [Cannon Duel] Implement rendering
- #767 [Cannon Duel] Integrate seat rotation and the turn indicator
- #768 [Cannon Duel] Integrate the shared match flow
- #769 [Cannon Duel] Implement the bot opponent with three difficulty tiers
- #770 [Cannon Duel] Create original art and wire the audio events
- #771 [Cannon Duel] Write unit and deterministic simulation tests
- #772 [Cannon Duel] QA pass against the definition of done

### carrom (15)

- #533 [Carrom] Build the game
- #534 [Carrom] Research: play the reference genre and document observed mechanics
- #535 [Carrom] Write the game spec
- #536 [Carrom] Scaffold the game package and manifest
- #537 [Carrom] Implement the state model and rules module
- #538 [Carrom] Wire up controls for both seats
- #539 [Carrom] Implement the core simulation
- #540 [Carrom] Implement scoring and the win condition
- #541 [Carrom] Implement rendering
- #542 [Carrom] Integrate seat rotation and the turn indicator
- #543 [Carrom] Integrate the shared match flow
- #544 [Carrom] Implement the bot opponent with three difficulty tiers
- #545 [Carrom] Create original art and wire the audio events
- #546 [Carrom] Write unit and deterministic simulation tests
- #547 [Carrom] QA pass against the definition of done

### checkers (15)

- #308 [Checkers] Build the game
- #309 [Checkers] Research: play the reference genre and document observed mechanics
- #310 [Checkers] Write the game spec
- #311 [Checkers] Scaffold the game package and manifest
- #312 [Checkers] Implement the state model and rules module
- #313 [Checkers] Wire up controls for both seats
- #314 [Checkers] Implement the core simulation
- #315 [Checkers] Implement scoring and the win condition
- #316 [Checkers] Implement rendering
- #317 [Checkers] Integrate seat rotation and the turn indicator
- #318 [Checkers] Integrate the shared match flow
- #319 [Checkers] Implement the bot opponent with three difficulty tiers
- #320 [Checkers] Create original art and wire the audio events
- #321 [Checkers] Write unit and deterministic simulation tests
- #322 [Checkers] QA pass against the definition of done

### chess (15)

- #293 [Chess] Build the game
- #294 [Chess] Research: play the reference genre and document observed mechanics
- #295 [Chess] Write the game spec
- #296 [Chess] Scaffold the game package and manifest
- #297 [Chess] Implement the state model and rules module
- #298 [Chess] Wire up controls for both seats
- #299 [Chess] Implement the core simulation
- #300 [Chess] Implement scoring and the win condition
- #301 [Chess] Implement rendering
- #302 [Chess] Integrate seat rotation and the turn indicator
- #303 [Chess] Integrate the shared match flow
- #304 [Chess] Implement the bot opponent with three difficulty tiers
- #305 [Chess] Create original art and wire the audio events
- #306 [Chess] Write unit and deterministic simulation tests
- #307 [Chess] QA pass against the definition of done

### chicken-jump (15)

- #1268 [Chicken Jump] Build the game
- #1269 [Chicken Jump] Research: play the reference genre and document observed mechanics
- #1270 [Chicken Jump] Write the game spec
- #1271 [Chicken Jump] Scaffold the game package and manifest
- #1272 [Chicken Jump] Implement the state model and rules module
- #1273 [Chicken Jump] Wire up controls for both seats
- #1274 [Chicken Jump] Implement the core simulation
- #1275 [Chicken Jump] Implement scoring and the win condition
- #1276 [Chicken Jump] Implement rendering
- #1277 [Chicken Jump] Implement the split-seat layout and per-seat HUD placement
- #1278 [Chicken Jump] Integrate the shared match flow
- #1279 [Chicken Jump] Implement the bot opponent with three difficulty tiers
- #1280 [Chicken Jump] Create original art and wire the audio events
- #1281 [Chicken Jump] Write unit and deterministic simulation tests
- #1282 [Chicken Jump] QA pass against the definition of done

### color-wars (15)

- #473 [Colour Wars] Build the game
- #474 [Colour Wars] Research: play the reference genre and document observed mechanics
- #475 [Colour Wars] Write the game spec
- #476 [Colour Wars] Scaffold the game package and manifest
- #477 [Colour Wars] Implement the state model and rules module
- #478 [Colour Wars] Wire up controls for both seats
- #479 [Colour Wars] Implement the core simulation
- #480 [Colour Wars] Implement scoring and the win condition
- #481 [Colour Wars] Implement rendering
- #482 [Colour Wars] Integrate seat rotation and the turn indicator
- #483 [Colour Wars] Integrate the shared match flow
- #484 [Colour Wars] Implement the bot opponent with three difficulty tiers
- #485 [Colour Wars] Create original art and wire the audio events
- #486 [Colour Wars] Write unit and deterministic simulation tests
- #487 [Colour Wars] QA pass against the definition of done

### cornhole (15)

- #578 [Cornhole] Build the game
- #579 [Cornhole] Research: play the reference genre and document observed mechanics
- #580 [Cornhole] Write the game spec
- #581 [Cornhole] Scaffold the game package and manifest
- #582 [Cornhole] Implement the state model and rules module
- #583 [Cornhole] Wire up controls for both seats
- #584 [Cornhole] Implement the core simulation
- #585 [Cornhole] Implement scoring and the win condition
- #586 [Cornhole] Implement rendering
- #587 [Cornhole] Integrate seat rotation and the turn indicator
- #588 [Cornhole] Integrate the shared match flow
- #589 [Cornhole] Implement the bot opponent with three difficulty tiers
- #590 [Cornhole] Create original art and wire the audio events
- #591 [Cornhole] Write unit and deterministic simulation tests
- #592 [Cornhole] QA pass against the definition of done

### crabby-volley (15)

- #848 [Crabby Volley] Build the game
- #849 [Crabby Volley] Research: play the reference genre and document observed mechanics
- #850 [Crabby Volley] Write the game spec
- #851 [Crabby Volley] Scaffold the game package and manifest
- #852 [Crabby Volley] Implement the state model and rules module
- #853 [Crabby Volley] Wire up controls for both seats
- #854 [Crabby Volley] Implement the core simulation
- #855 [Crabby Volley] Implement scoring and the win condition
- #856 [Crabby Volley] Implement rendering
- #857 [Crabby Volley] Implement the split-seat layout and per-seat HUD placement
- #858 [Crabby Volley] Integrate the shared match flow
- #859 [Crabby Volley] Implement the bot opponent with three difficulty tiers
- #860 [Crabby Volley] Create original art and wire the audio events
- #861 [Crabby Volley] Write unit and deterministic simulation tests
- #862 [Crabby Volley] QA pass against the definition of done

### crash-it (15)

- #1613 [Crash It] Build the game
- #1614 [Crash It] Research: play the reference genre and document observed mechanics
- #1615 [Crash It] Write the game spec
- #1616 [Crash It] Scaffold the game package and manifest
- #1617 [Crash It] Implement the state model and rules module
- #1618 [Crash It] Wire up controls for both seats
- #1619 [Crash It] Implement the core simulation
- #1620 [Crash It] Implement scoring and the win condition
- #1621 [Crash It] Implement rendering
- #1622 [Crash It] Implement the split-seat layout and per-seat HUD placement
- #1623 [Crash It] Integrate the shared match flow
- #1624 [Crash It] Implement the bot opponent with three difficulty tiers
- #1625 [Crash It] Create original art and wire the audio events
- #1626 [Crash It] Write unit and deterministic simulation tests
- #1627 [Crash It] QA pass against the definition of done

### cup-pong (15)

- #623 [Cup Pong] Build the game
- #624 [Cup Pong] Research: play the reference genre and document observed mechanics
- #625 [Cup Pong] Write the game spec
- #626 [Cup Pong] Scaffold the game package and manifest
- #627 [Cup Pong] Implement the state model and rules module
- #628 [Cup Pong] Wire up controls for both seats
- #629 [Cup Pong] Implement the core simulation
- #630 [Cup Pong] Implement scoring and the win condition
- #631 [Cup Pong] Implement rendering
- #632 [Cup Pong] Integrate seat rotation and the turn indicator
- #633 [Cup Pong] Integrate the shared match flow
- #634 [Cup Pong] Implement the bot opponent with three difficulty tiers
- #635 [Cup Pong] Create original art and wire the audio events
- #636 [Cup Pong] Write unit and deterministic simulation tests
- #637 [Cup Pong] QA pass against the definition of done

### darts (15)

- #563 [Darts] Build the game
- #564 [Darts] Research: play the reference genre and document observed mechanics
- #565 [Darts] Write the game spec
- #566 [Darts] Scaffold the game package and manifest
- #567 [Darts] Implement the state model and rules module
- #568 [Darts] Wire up controls for both seats
- #569 [Darts] Implement the core simulation
- #570 [Darts] Implement scoring and the win condition
- #571 [Darts] Implement rendering
- #572 [Darts] Integrate seat rotation and the turn indicator
- #573 [Darts] Integrate the shared match flow
- #574 [Darts] Implement the bot opponent with three difficulty tiers
- #575 [Darts] Create original art and wire the audio events
- #576 [Darts] Write unit and deterministic simulation tests
- #577 [Darts] QA pass against the definition of done

### disco-battle (15)

- #1358 [Disco Battle] Build the game
- #1359 [Disco Battle] Research: play the reference genre and document observed mechanics
- #1360 [Disco Battle] Write the game spec
- #1361 [Disco Battle] Scaffold the game package and manifest
- #1362 [Disco Battle] Implement the state model and rules module
- #1363 [Disco Battle] Wire up controls for both seats
- #1364 [Disco Battle] Implement the core simulation
- #1365 [Disco Battle] Implement scoring and the win condition
- #1366 [Disco Battle] Implement rendering
- #1367 [Disco Battle] Implement the split-seat layout and per-seat HUD placement
- #1368 [Disco Battle] Integrate the shared match flow
- #1369 [Disco Battle] Implement the bot opponent with three difficulty tiers
- #1370 [Disco Battle] Create original art and wire the audio events
- #1371 [Disco Battle] Write unit and deterministic simulation tests
- #1372 [Disco Battle] QA pass against the definition of done

### dots-and-boxes (15)

- #353 [Dots and Boxes] Build the game
- #354 [Dots and Boxes] Research: play the reference genre and document observed mechanics
- #355 [Dots and Boxes] Write the game spec
- #356 [Dots and Boxes] Scaffold the game package and manifest
- #357 [Dots and Boxes] Implement the state model and rules module
- #358 [Dots and Boxes] Wire up controls for both seats
- #359 [Dots and Boxes] Implement the core simulation
- #360 [Dots and Boxes] Implement scoring and the win condition
- #361 [Dots and Boxes] Implement rendering
- #362 [Dots and Boxes] Integrate seat rotation and the turn indicator
- #363 [Dots and Boxes] Integrate the shared match flow
- #364 [Dots and Boxes] Implement the bot opponent with three difficulty tiers
- #365 [Dots and Boxes] Create original art and wire the audio events
- #366 [Dots and Boxes] Write unit and deterministic simulation tests
- #367 [Dots and Boxes] QA pass against the definition of done

### dung-battle (15)

- #1433 [Dung Battle] Build the game
- #1434 [Dung Battle] Research: play the reference genre and document observed mechanics
- #1435 [Dung Battle] Write the game spec
- #1436 [Dung Battle] Scaffold the game package and manifest
- #1437 [Dung Battle] Implement the state model and rules module
- #1438 [Dung Battle] Wire up controls for both seats
- #1439 [Dung Battle] Implement the core simulation
- #1440 [Dung Battle] Implement scoring and the win condition
- #1441 [Dung Battle] Implement rendering
- #1442 [Dung Battle] Implement the split-seat layout and per-seat HUD placement
- #1443 [Dung Battle] Integrate the shared match flow
- #1444 [Dung Battle] Implement the bot opponent with three difficulty tiers
- #1445 [Dung Battle] Create original art and wire the audio events
- #1446 [Dung Battle] Write unit and deterministic simulation tests
- #1447 [Dung Battle] QA pass against the definition of done

### explosive-festival (15)

- #1463 [Explosive Festival] Build the game
- #1464 [Explosive Festival] Research: play the reference genre and document observed mechanics
- #1465 [Explosive Festival] Write the game spec
- #1466 [Explosive Festival] Scaffold the game package and manifest
- #1467 [Explosive Festival] Implement the state model and rules module
- #1468 [Explosive Festival] Wire up controls for both seats
- #1469 [Explosive Festival] Implement the core simulation
- #1470 [Explosive Festival] Implement scoring and the win condition
- #1471 [Explosive Festival] Implement rendering
- #1472 [Explosive Festival] Implement the split-seat layout and per-seat HUD placement
- #1473 [Explosive Festival] Integrate the shared match flow
- #1474 [Explosive Festival] Implement the bot opponent with three difficulty tiers
- #1475 [Explosive Festival] Create original art and wire the audio events
- #1476 [Explosive Festival] Write unit and deterministic simulation tests
- #1477 [Explosive Festival] QA pass against the definition of done

### fatal-siege (15)

- #1448 [Fatal Siege] Build the game
- #1449 [Fatal Siege] Research: play the reference genre and document observed mechanics
- #1450 [Fatal Siege] Write the game spec
- #1451 [Fatal Siege] Scaffold the game package and manifest
- #1452 [Fatal Siege] Implement the state model and rules module
- #1453 [Fatal Siege] Wire up controls for both seats
- #1454 [Fatal Siege] Implement the core simulation
- #1455 [Fatal Siege] Implement scoring and the win condition
- #1456 [Fatal Siege] Implement rendering
- #1457 [Fatal Siege] Implement the split-seat layout and per-seat HUD placement
- #1458 [Fatal Siege] Integrate the shared match flow
- #1459 [Fatal Siege] Implement the bot opponent with three difficulty tiers
- #1460 [Fatal Siege] Create original art and wire the audio events
- #1461 [Fatal Siege] Write unit and deterministic simulation tests
- #1462 [Fatal Siege] QA pass against the definition of done

### flappy-jump (15)

- #1283 [Flappy Jump] Build the game
- #1284 [Flappy Jump] Research: play the reference genre and document observed mechanics
- #1285 [Flappy Jump] Write the game spec
- #1286 [Flappy Jump] Scaffold the game package and manifest
- #1287 [Flappy Jump] Implement the state model and rules module
- #1288 [Flappy Jump] Wire up controls for both seats
- #1289 [Flappy Jump] Implement the core simulation
- #1290 [Flappy Jump] Implement scoring and the win condition
- #1291 [Flappy Jump] Implement rendering
- #1292 [Flappy Jump] Implement the split-seat layout and per-seat HUD placement
- #1293 [Flappy Jump] Integrate the shared match flow
- #1294 [Flappy Jump] Implement the bot opponent with three difficulty tiers
- #1295 [Flappy Jump] Create original art and wire the audio events
- #1296 [Flappy Jump] Write unit and deterministic simulation tests
- #1297 [Flappy Jump] QA pass against the definition of done

### four-in-a-row (15)

- #278 [Drop Four] Build the game
- #279 [Drop Four] Research: play the reference genre and document observed mechanics
- #280 [Drop Four] Write the game spec
- #281 [Drop Four] Scaffold the game package and manifest
- #282 [Drop Four] Implement the state model and rules module
- #283 [Drop Four] Wire up controls for both seats
- #284 [Drop Four] Implement the core simulation
- #285 [Drop Four] Implement scoring and the win condition
- #286 [Drop Four] Implement rendering
- #287 [Drop Four] Integrate seat rotation and the turn indicator
- #288 [Drop Four] Integrate the shared match flow
- #289 [Drop Four] Implement the bot opponent with three difficulty tiers
- #290 [Drop Four] Create original art and wire the audio events
- #291 [Drop Four] Write unit and deterministic simulation tests
- #292 [Drop Four] QA pass against the definition of done

### frogs-fight (15)

- #1800 [Frogs Fight] Build the game
- #1801 [Frogs Fight] Research: play the reference genre and document observed mechanics
- #1802 [Frogs Fight] Write the game spec
- #1803 [Frogs Fight] Scaffold the game package and manifest
- #1804 [Frogs Fight] Implement the state model and rules module
- #1805 [Frogs Fight] Wire up controls for both seats
- #1806 [Frogs Fight] Implement the core simulation
- #1807 [Frogs Fight] Implement scoring and the win condition
- #1808 [Frogs Fight] Implement rendering
- #1809 [Frogs Fight] Implement the split-seat layout and per-seat HUD placement
- #1810 [Frogs Fight] Integrate the shared match flow
- #1811 [Frogs Fight] Implement the bot opponent with three difficulty tiers
- #1812 [Frogs Fight] Create original art and wire the audio events
- #1813 [Frogs Fight] Write unit and deterministic simulation tests
- #1814 [Frogs Fight] QA pass against the definition of done

### frozen-beaks (15)

- #1073 [Frozen Beaks] Build the game
- #1074 [Frozen Beaks] Research: play the reference genre and document observed mechanics
- #1075 [Frozen Beaks] Write the game spec
- #1076 [Frozen Beaks] Scaffold the game package and manifest
- #1077 [Frozen Beaks] Implement the state model and rules module
- #1078 [Frozen Beaks] Wire up controls for both seats
- #1079 [Frozen Beaks] Implement the core simulation
- #1080 [Frozen Beaks] Implement scoring and the win condition
- #1081 [Frozen Beaks] Implement rendering
- #1082 [Frozen Beaks] Implement the split-seat layout and per-seat HUD placement
- #1083 [Frozen Beaks] Integrate the shared match flow
- #1084 [Frozen Beaks] Implement the bot opponent with three difficulty tiers
- #1085 [Frozen Beaks] Create original art and wire the audio events
- #1086 [Frozen Beaks] Write unit and deterministic simulation tests
- #1087 [Frozen Beaks] QA pass against the definition of done

### fruit-duel (15)

- #1043 [Fruit Duel] Build the game
- #1044 [Fruit Duel] Research: play the reference genre and document observed mechanics
- #1045 [Fruit Duel] Write the game spec
- #1046 [Fruit Duel] Scaffold the game package and manifest
- #1047 [Fruit Duel] Implement the state model and rules module
- #1048 [Fruit Duel] Wire up controls for both seats
- #1049 [Fruit Duel] Implement the core simulation
- #1050 [Fruit Duel] Implement scoring and the win condition
- #1051 [Fruit Duel] Implement rendering
- #1052 [Fruit Duel] Implement the split-seat layout and per-seat HUD placement
- #1053 [Fruit Duel] Integrate the shared match flow
- #1054 [Fruit Duel] Implement the bot opponent with three difficulty tiers
- #1055 [Fruit Duel] Create original art and wire the audio events
- #1056 [Fruit Duel] Write unit and deterministic simulation tests
- #1057 [Fruit Duel] QA pass against the definition of done

### golf-football (15)

- #653 [Golf Football] Build the game
- #654 [Golf Football] Research: play the reference genre and document observed mechanics
- #655 [Golf Football] Write the game spec
- #656 [Golf Football] Scaffold the game package and manifest
- #657 [Golf Football] Implement the state model and rules module
- #658 [Golf Football] Wire up controls for both seats
- #659 [Golf Football] Implement the core simulation
- #660 [Golf Football] Implement scoring and the win condition
- #661 [Golf Football] Implement rendering
- #662 [Golf Football] Integrate seat rotation and the turn indicator
- #663 [Golf Football] Integrate the shared match flow
- #664 [Golf Football] Implement the bot opponent with three difficulty tiers
- #665 [Golf Football] Create original art and wire the audio events
- #666 [Golf Football] Write unit and deterministic simulation tests
- #667 [Golf Football] QA pass against the definition of done

### gravity-run (15)

- #1313 [Gravity Run] Build the game
- #1314 [Gravity Run] Research: play the reference genre and document observed mechanics
- #1315 [Gravity Run] Write the game spec
- #1316 [Gravity Run] Scaffold the game package and manifest
- #1317 [Gravity Run] Implement the state model and rules module
- #1318 [Gravity Run] Wire up controls for both seats
- #1319 [Gravity Run] Implement the core simulation
- #1320 [Gravity Run] Implement scoring and the win condition
- #1321 [Gravity Run] Implement rendering
- #1322 [Gravity Run] Implement the split-seat layout and per-seat HUD placement
- #1323 [Gravity Run] Integrate the shared match flow
- #1324 [Gravity Run] Implement the bot opponent with three difficulty tiers
- #1325 [Gravity Run] Create original art and wire the audio events
- #1326 [Gravity Run] Write unit and deterministic simulation tests
- #1327 [Gravity Run] QA pass against the definition of done

### guard-and-thief (15)

- #1373 [Guard and Thief] Build the game
- #1374 [Guard and Thief] Research: play the reference genre and document observed mechanics
- #1375 [Guard and Thief] Write the game spec
- #1376 [Guard and Thief] Scaffold the game package and manifest
- #1377 [Guard and Thief] Implement the state model and rules module
- #1378 [Guard and Thief] Wire up controls for both seats
- #1379 [Guard and Thief] Implement the core simulation
- #1380 [Guard and Thief] Implement scoring and the win condition
- #1381 [Guard and Thief] Implement rendering
- #1382 [Guard and Thief] Implement the split-seat layout and per-seat HUD placement
- #1383 [Guard and Thief] Integrate the shared match flow
- #1384 [Guard and Thief] Implement the bot opponent with three difficulty tiers
- #1385 [Guard and Thief] Create original art and wire the audio events
- #1386 [Guard and Thief] Write unit and deterministic simulation tests
- #1387 [Guard and Thief] QA pass against the definition of done

### guess-the-person (15)

- #488 [Guess Who] Build the game
- #489 [Guess Who] Research: play the reference genre and document observed mechanics
- #490 [Guess Who] Write the game spec
- #491 [Guess Who] Scaffold the game package and manifest
- #492 [Guess Who] Implement the state model and rules module
- #493 [Guess Who] Wire up controls for both seats
- #494 [Guess Who] Implement the core simulation
- #495 [Guess Who] Implement scoring and the win condition
- #496 [Guess Who] Implement rendering
- #497 [Guess Who] Integrate seat rotation and the turn indicator
- #498 [Guess Who] Integrate the shared match flow
- #499 [Guess Who] Implement the bot opponent with three difficulty tiers
- #500 [Guess Who] Create original art and wire the audio events
- #501 [Guess Who] Write unit and deterministic simulation tests
- #502 [Guess Who] QA pass against the definition of done

### hammer-hit (15)

- #788 [Hammer Hit] Build the game
- #789 [Hammer Hit] Research: play the reference genre and document observed mechanics
- #790 [Hammer Hit] Write the game spec
- #791 [Hammer Hit] Scaffold the game package and manifest
- #792 [Hammer Hit] Implement the state model and rules module
- #793 [Hammer Hit] Wire up controls for both seats
- #794 [Hammer Hit] Implement the core simulation
- #795 [Hammer Hit] Implement scoring and the win condition
- #796 [Hammer Hit] Implement rendering
- #797 [Hammer Hit] Integrate seat rotation and the turn indicator
- #798 [Hammer Hit] Integrate the shared match flow
- #799 [Hammer Hit] Implement the bot opponent with three difficulty tiers
- #800 [Hammer Hit] Create original art and wire the audio events
- #801 [Hammer Hit] Write unit and deterministic simulation tests
- #802 [Hammer Hit] QA pass against the definition of done

### hand-slap (15)

- #938 [Hand Slap] Build the game
- #939 [Hand Slap] Research: play the reference genre and document observed mechanics
- #940 [Hand Slap] Write the game spec
- #941 [Hand Slap] Scaffold the game package and manifest
- #942 [Hand Slap] Implement the state model and rules module
- #943 [Hand Slap] Wire up controls for both seats
- #944 [Hand Slap] Implement the core simulation
- #945 [Hand Slap] Implement scoring and the win condition
- #946 [Hand Slap] Implement rendering
- #947 [Hand Slap] Implement the split-seat layout and per-seat HUD placement
- #948 [Hand Slap] Integrate the shared match flow
- #949 [Hand Slap] Implement the bot opponent with three difficulty tiers
- #950 [Hand Slap] Create original art and wire the audio events
- #951 [Hand Slap] Write unit and deterministic simulation tests
- #952 [Hand Slap] QA pass against the definition of done

### happy-birds (15)

- #1298 [Happy Birds] Build the game
- #1299 [Happy Birds] Research: play the reference genre and document observed mechanics
- #1300 [Happy Birds] Write the game spec
- #1301 [Happy Birds] Scaffold the game package and manifest
- #1302 [Happy Birds] Implement the state model and rules module
- #1303 [Happy Birds] Wire up controls for both seats
- #1304 [Happy Birds] Implement the core simulation
- #1305 [Happy Birds] Implement scoring and the win condition
- #1306 [Happy Birds] Implement rendering
- #1307 [Happy Birds] Implement the split-seat layout and per-seat HUD placement
- #1308 [Happy Birds] Integrate the shared match flow
- #1309 [Happy Birds] Implement the bot opponent with three difficulty tiers
- #1310 [Happy Birds] Create original art and wire the audio events
- #1311 [Happy Birds] Write unit and deterministic simulation tests
- #1312 [Happy Birds] QA pass against the definition of done

### happy-hippos (15)

- #1088 [Happy Hippos] Build the game
- #1089 [Happy Hippos] Research: play the reference genre and document observed mechanics
- #1090 [Happy Hippos] Write the game spec
- #1091 [Happy Hippos] Scaffold the game package and manifest
- #1092 [Happy Hippos] Implement the state model and rules module
- #1093 [Happy Hippos] Wire up controls for both seats
- #1094 [Happy Hippos] Implement the core simulation
- #1095 [Happy Hippos] Implement scoring and the win condition
- #1096 [Happy Hippos] Implement rendering
- #1097 [Happy Hippos] Implement the split-seat layout and per-seat HUD placement
- #1098 [Happy Hippos] Integrate the shared match flow
- #1099 [Happy Hippos] Implement the bot opponent with three difficulty tiers
- #1100 [Happy Hippos] Create original art and wire the audio events
- #1101 [Happy Hippos] Write unit and deterministic simulation tests
- #1102 [Happy Hippos] QA pass against the definition of done

### hot-potato (15)

- #1028 [Hot Potato] Build the game
- #1029 [Hot Potato] Research: play the reference genre and document observed mechanics
- #1030 [Hot Potato] Write the game spec
- #1031 [Hot Potato] Scaffold the game package and manifest
- #1032 [Hot Potato] Implement the state model and rules module
- #1033 [Hot Potato] Wire up controls for both seats
- #1034 [Hot Potato] Implement the core simulation
- #1035 [Hot Potato] Implement scoring and the win condition
- #1036 [Hot Potato] Implement rendering
- #1037 [Hot Potato] Implement the split-seat layout and per-seat HUD placement
- #1038 [Hot Potato] Integrate the shared match flow
- #1039 [Hot Potato] Implement the bot opponent with three difficulty tiers
- #1040 [Hot Potato] Create original art and wire the audio events
- #1041 [Hot Potato] Write unit and deterministic simulation tests
- #1042 [Hot Potato] QA pass against the definition of done

### king-of-the-yard (15)

- #1418 [King of the Yard] Build the game
- #1419 [King of the Yard] Research: play the reference genre and document observed mechanics
- #1420 [King of the Yard] Write the game spec
- #1421 [King of the Yard] Scaffold the game package and manifest
- #1422 [King of the Yard] Implement the state model and rules module
- #1423 [King of the Yard] Wire up controls for both seats
- #1424 [King of the Yard] Implement the core simulation
- #1425 [King of the Yard] Implement scoring and the win condition
- #1426 [King of the Yard] Implement rendering
- #1427 [King of the Yard] Implement the split-seat layout and per-seat HUD placement
- #1428 [King of the Yard] Integrate the shared match flow
- #1429 [King of the Yard] Implement the bot opponent with three difficulty tiers
- #1430 [King of the Yard] Create original art and wire the audio events
- #1431 [King of the Yard] Write unit and deterministic simulation tests
- #1432 [King of the Yard] QA pass against the definition of done

### knife-thrower (15)

- #668 [Knife Thrower] Build the game
- #669 [Knife Thrower] Research: play the reference genre and document observed mechanics
- #670 [Knife Thrower] Write the game spec
- #671 [Knife Thrower] Scaffold the game package and manifest
- #672 [Knife Thrower] Implement the state model and rules module
- #673 [Knife Thrower] Wire up controls for both seats
- #674 [Knife Thrower] Implement the core simulation
- #675 [Knife Thrower] Implement scoring and the win condition
- #676 [Knife Thrower] Implement rendering
- #677 [Knife Thrower] Integrate seat rotation and the turn indicator
- #678 [Knife Thrower] Integrate the shared match flow
- #679 [Knife Thrower] Implement the bot opponent with three difficulty tiers
- #680 [Knife Thrower] Create original art and wire the audio events
- #681 [Knife Thrower] Write unit and deterministic simulation tests
- #682 [Knife Thrower] QA pass against the definition of done

### light-fingers (15)

- #1163 [Light Fingers] Build the game
- #1164 [Light Fingers] Research: play the reference genre and document observed mechanics
- #1165 [Light Fingers] Write the game spec
- #1166 [Light Fingers] Scaffold the game package and manifest
- #1167 [Light Fingers] Implement the state model and rules module
- #1168 [Light Fingers] Wire up controls for both seats
- #1169 [Light Fingers] Implement the core simulation
- #1170 [Light Fingers] Implement scoring and the win condition
- #1171 [Light Fingers] Implement rendering
- #1172 [Light Fingers] Implement the split-seat layout and per-seat HUD placement
- #1173 [Light Fingers] Integrate the shared match flow
- #1174 [Light Fingers] Implement the bot opponent with three difficulty tiers
- #1175 [Light Fingers] Create original art and wire the audio events
- #1176 [Light Fingers] Write unit and deterministic simulation tests
- #1177 [Light Fingers] QA pass against the definition of done

### ludo (15)

- #368 [Ludo Dash] Build the game
- #369 [Ludo Dash] Research: play the reference genre and document observed mechanics
- #370 [Ludo Dash] Write the game spec
- #371 [Ludo Dash] Scaffold the game package and manifest
- #372 [Ludo Dash] Implement the state model and rules module
- #373 [Ludo Dash] Wire up controls for both seats
- #374 [Ludo Dash] Implement the core simulation
- #375 [Ludo Dash] Implement scoring and the win condition
- #376 [Ludo Dash] Implement rendering
- #377 [Ludo Dash] Integrate seat rotation and the turn indicator
- #378 [Ludo Dash] Integrate the shared match flow
- #379 [Ludo Dash] Implement the bot opponent with three difficulty tiers
- #380 [Ludo Dash] Create original art and wire the audio events
- #381 [Ludo Dash] Write unit and deterministic simulation tests
- #382 [Ludo Dash] QA pass against the definition of done

### lumber-jack (15)

- #1223 [Lumberjack] Build the game
- #1224 [Lumberjack] Research: play the reference genre and document observed mechanics
- #1225 [Lumberjack] Write the game spec
- #1226 [Lumberjack] Scaffold the game package and manifest
- #1227 [Lumberjack] Implement the state model and rules module
- #1228 [Lumberjack] Wire up controls for both seats
- #1229 [Lumberjack] Implement the core simulation
- #1230 [Lumberjack] Implement scoring and the win condition
- #1231 [Lumberjack] Implement rendering
- #1232 [Lumberjack] Implement the split-seat layout and per-seat HUD placement
- #1233 [Lumberjack] Integrate the shared match flow
- #1234 [Lumberjack] Implement the bot opponent with three difficulty tiers
- #1235 [Lumberjack] Create original art and wire the audio events
- #1236 [Lumberjack] Write unit and deterministic simulation tests
- #1237 [Lumberjack] QA pass against the definition of done

### mancala (15)

- #338 [Mancala Pits] Build the game
- #339 [Mancala Pits] Research: play the reference genre and document observed mechanics
- #340 [Mancala Pits] Write the game spec
- #341 [Mancala Pits] Scaffold the game package and manifest
- #342 [Mancala Pits] Implement the state model and rules module
- #343 [Mancala Pits] Wire up controls for both seats
- #344 [Mancala Pits] Implement the core simulation
- #345 [Mancala Pits] Implement scoring and the win condition
- #346 [Mancala Pits] Implement rendering
- #347 [Mancala Pits] Integrate seat rotation and the turn indicator
- #348 [Mancala Pits] Integrate the shared match flow
- #349 [Mancala Pits] Implement the bot opponent with three difficulty tiers
- #350 [Mancala Pits] Create original art and wire the audio events
- #351 [Mancala Pits] Write unit and deterministic simulation tests
- #352 [Mancala Pits] QA pass against the definition of done

### match (15)

- #1523 [Match Rush] Build the game
- #1524 [Match Rush] Research: play the reference genre and document observed mechanics
- #1525 [Match Rush] Write the game spec
- #1526 [Match Rush] Scaffold the game package and manifest
- #1527 [Match Rush] Implement the state model and rules module
- #1528 [Match Rush] Wire up controls for both seats
- #1529 [Match Rush] Implement the core simulation
- #1530 [Match Rush] Implement scoring and the win condition
- #1531 [Match Rush] Implement rendering
- #1532 [Match Rush] Implement the split-seat layout and per-seat HUD placement
- #1533 [Match Rush] Integrate the shared match flow
- #1534 [Match Rush] Implement the bot opponent with three difficulty tiers
- #1535 [Match Rush] Create original art and wire the audio events
- #1536 [Match Rush] Write unit and deterministic simulation tests
- #1537 [Match Rush] QA pass against the definition of done

### math-quiz (15)

- #968 [Math Duel] Build the game
- #969 [Math Duel] Research: play the reference genre and document observed mechanics
- #970 [Math Duel] Write the game spec
- #971 [Math Duel] Scaffold the game package and manifest
- #972 [Math Duel] Implement the state model and rules module
- #973 [Math Duel] Wire up controls for both seats
- #974 [Math Duel] Implement the core simulation
- #975 [Math Duel] Implement scoring and the win condition
- #976 [Math Duel] Implement rendering
- #977 [Math Duel] Implement the split-seat layout and per-seat HUD placement
- #978 [Math Duel] Integrate the shared match flow
- #979 [Math Duel] Implement the bot opponent with three difficulty tiers
- #980 [Math Duel] Create original art and wire the audio events
- #981 [Math Duel] Write unit and deterministic simulation tests
- #982 [Math Duel] QA pass against the definition of done

### maze-paint (13)

- #1736 [Maze Paint] Build the game
- #1737 [Maze Paint] Research: play the reference genre and document observed mechanics
- #1738 [Maze Paint] Write the game spec
- #1739 [Maze Paint] Scaffold the game package and manifest
- #1740 [Maze Paint] Implement the state model and rules module
- #1741 [Maze Paint] Wire up controls for both seats
- #1742 [Maze Paint] Implement the core simulation
- #1743 [Maze Paint] Implement scoring and the win condition
- #1744 [Maze Paint] Implement rendering
- #1745 [Maze Paint] Integrate the shared match flow
- #1746 [Maze Paint] Create original art and wire the audio events
- #1747 [Maze Paint] Write unit and deterministic simulation tests
- #1748 [Maze Paint] QA pass against the definition of done

### memory (15)

- #998 [Memory Match] Build the game
- #999 [Memory Match] Research: play the reference genre and document observed mechanics
- #1000 [Memory Match] Write the game spec
- #1001 [Memory Match] Scaffold the game package and manifest
- #1002 [Memory Match] Implement the state model and rules module
- #1003 [Memory Match] Wire up controls for both seats
- #1004 [Memory Match] Implement the core simulation
- #1005 [Memory Match] Implement scoring and the win condition
- #1006 [Memory Match] Implement rendering
- #1007 [Memory Match] Implement the split-seat layout and per-seat HUD placement
- #1008 [Memory Match] Integrate the shared match flow
- #1009 [Memory Match] Implement the bot opponent with three difficulty tiers
- #1010 [Memory Match] Create original art and wire the audio events
- #1011 [Memory Match] Write unit and deterministic simulation tests
- #1012 [Memory Match] QA pass against the definition of done

### mini-golf (15)

- #503 [Mini Golf] Build the game
- #504 [Mini Golf] Research: play the reference genre and document observed mechanics
- #505 [Mini Golf] Write the game spec
- #506 [Mini Golf] Scaffold the game package and manifest
- #507 [Mini Golf] Implement the state model and rules module
- #508 [Mini Golf] Wire up controls for both seats
- #509 [Mini Golf] Implement the core simulation
- #510 [Mini Golf] Implement scoring and the win condition
- #511 [Mini Golf] Implement rendering
- #512 [Mini Golf] Integrate seat rotation and the turn indicator
- #513 [Mini Golf] Integrate the shared match flow
- #514 [Mini Golf] Implement the bot opponent with three difficulty tiers
- #515 [Mini Golf] Create original art and wire the audio events
- #516 [Mini Golf] Write unit and deterministic simulation tests
- #517 [Mini Golf] QA pass against the definition of done

### mini-soccer (15)

- #878 [Mini Soccer] Build the game
- #879 [Mini Soccer] Research: play the reference genre and document observed mechanics
- #880 [Mini Soccer] Write the game spec
- #881 [Mini Soccer] Scaffold the game package and manifest
- #882 [Mini Soccer] Implement the state model and rules module
- #883 [Mini Soccer] Wire up controls for both seats
- #884 [Mini Soccer] Implement the core simulation
- #885 [Mini Soccer] Implement scoring and the win condition
- #886 [Mini Soccer] Implement rendering
- #887 [Mini Soccer] Implement the split-seat layout and per-seat HUD placement
- #888 [Mini Soccer] Integrate the shared match flow
- #889 [Mini Soccer] Implement the bot opponent with three difficulty tiers
- #890 [Mini Soccer] Create original art and wire the audio events
- #891 [Mini Soccer] Write unit and deterministic simulation tests
- #892 [Mini Soccer] QA pass against the definition of done

### money-grabber (15)

- #1148 [Money Grabber] Build the game
- #1149 [Money Grabber] Research: play the reference genre and document observed mechanics
- #1150 [Money Grabber] Write the game spec
- #1151 [Money Grabber] Scaffold the game package and manifest
- #1152 [Money Grabber] Implement the state model and rules module
- #1153 [Money Grabber] Wire up controls for both seats
- #1154 [Money Grabber] Implement the core simulation
- #1155 [Money Grabber] Implement scoring and the win condition
- #1156 [Money Grabber] Implement rendering
- #1157 [Money Grabber] Implement the split-seat layout and per-seat HUD placement
- #1158 [Money Grabber] Integrate the shared match flow
- #1159 [Money Grabber] Implement the bot opponent with three difficulty tiers
- #1160 [Money Grabber] Create original art and wire the audio events
- #1161 [Money Grabber] Write unit and deterministic simulation tests
- #1162 [Money Grabber] QA pass against the definition of done

### nuts-and-bolts (13)

- #1723 [Nuts and Bolts] Build the game
- #1724 [Nuts and Bolts] Research: play the reference genre and document observed mechanics
- #1725 [Nuts and Bolts] Write the game spec
- #1726 [Nuts and Bolts] Scaffold the game package and manifest
- #1727 [Nuts and Bolts] Implement the state model and rules module
- #1728 [Nuts and Bolts] Wire up controls for both seats
- #1729 [Nuts and Bolts] Implement the core simulation
- #1730 [Nuts and Bolts] Implement scoring and the win condition
- #1731 [Nuts and Bolts] Implement rendering
- #1732 [Nuts and Bolts] Integrate the shared match flow
- #1733 [Nuts and Bolts] Create original art and wire the audio events
- #1734 [Nuts and Bolts] Write unit and deterministic simulation tests
- #1735 [Nuts and Bolts] QA pass against the definition of done

### paint-fight (15)

- #1178 [Paint Fight] Build the game
- #1179 [Paint Fight] Research: play the reference genre and document observed mechanics
- #1180 [Paint Fight] Write the game spec
- #1181 [Paint Fight] Scaffold the game package and manifest
- #1182 [Paint Fight] Implement the state model and rules module
- #1183 [Paint Fight] Wire up controls for both seats
- #1184 [Paint Fight] Implement the core simulation
- #1185 [Paint Fight] Implement scoring and the win condition
- #1186 [Paint Fight] Implement rendering
- #1187 [Paint Fight] Implement the split-seat layout and per-seat HUD placement
- #1188 [Paint Fight] Integrate the shared match flow
- #1189 [Paint Fight] Implement the bot opponent with three difficulty tiers
- #1190 [Paint Fight] Create original art and wire the audio events
- #1191 [Paint Fight] Write unit and deterministic simulation tests
- #1192 [Paint Fight] QA pass against the definition of done

### penalty-kicks (15)

- #1830 [Penalty Kicks] Build the game
- #1831 [Penalty Kicks] Research: play the reference genre and document observed mechanics
- #1832 [Penalty Kicks] Write the game spec
- #1833 [Penalty Kicks] Scaffold the game package and manifest
- #1834 [Penalty Kicks] Implement the state model and rules module
- #1835 [Penalty Kicks] Wire up controls for both seats
- #1836 [Penalty Kicks] Implement the core simulation
- #1837 [Penalty Kicks] Implement scoring and the win condition
- #1838 [Penalty Kicks] Implement rendering
- #1839 [Penalty Kicks] Implement the split-seat layout and per-seat HUD placement
- #1840 [Penalty Kicks] Integrate the shared match flow
- #1841 [Penalty Kicks] Implement the bot opponent with three difficulty tiers
- #1842 [Penalty Kicks] Create original art and wire the audio events
- #1843 [Penalty Kicks] Write unit and deterministic simulation tests
- #1844 [Penalty Kicks] QA pass against the definition of done

### pinball (15)

- #1478 [Pinball Duel] Build the game
- #1479 [Pinball Duel] Research: play the reference genre and document observed mechanics
- #1480 [Pinball Duel] Write the game spec
- #1481 [Pinball Duel] Scaffold the game package and manifest
- #1482 [Pinball Duel] Implement the state model and rules module
- #1483 [Pinball Duel] Wire up controls for both seats
- #1484 [Pinball Duel] Implement the core simulation
- #1485 [Pinball Duel] Implement scoring and the win condition
- #1486 [Pinball Duel] Implement rendering
- #1487 [Pinball Duel] Implement the split-seat layout and per-seat HUD placement
- #1488 [Pinball Duel] Integrate the shared match flow
- #1489 [Pinball Duel] Implement the bot opponent with three difficulty tiers
- #1490 [Pinball Duel] Create original art and wire the audio events
- #1491 [Pinball Duel] Write unit and deterministic simulation tests
- #1492 [Pinball Duel] QA pass against the definition of done

### ping-pong (15)

- #1755 [Ping Pong] Build the game
- #1756 [Ping Pong] Research: play the reference genre and document observed mechanics
- #1757 [Ping Pong] Write the game spec
- #1758 [Ping Pong] Scaffold the game package and manifest
- #1759 [Ping Pong] Implement the state model and rules module
- #1760 [Ping Pong] Wire up controls for both seats
- #1761 [Ping Pong] Implement the core simulation
- #1762 [Ping Pong] Implement scoring and the win condition
- #1763 [Ping Pong] Implement rendering
- #1764 [Ping Pong] Implement the split-seat layout and per-seat HUD placement
- #1765 [Ping Pong] Integrate the shared match flow
- #1766 [Ping Pong] Implement the bot opponent with three difficulty tiers
- #1767 [Ping Pong] Create original art and wire the audio events
- #1768 [Ping Pong] Write unit and deterministic simulation tests
- #1769 [Ping Pong] QA pass against the definition of done

### piranha-rush (15)

- #1103 [Piranha Rush] Build the game
- #1104 [Piranha Rush] Research: play the reference genre and document observed mechanics
- #1105 [Piranha Rush] Write the game spec
- #1106 [Piranha Rush] Scaffold the game package and manifest
- #1107 [Piranha Rush] Implement the state model and rules module
- #1108 [Piranha Rush] Wire up controls for both seats
- #1109 [Piranha Rush] Implement the core simulation
- #1110 [Piranha Rush] Implement scoring and the win condition
- #1111 [Piranha Rush] Implement rendering
- #1112 [Piranha Rush] Implement the split-seat layout and per-seat HUD placement
- #1113 [Piranha Rush] Integrate the shared match flow
- #1114 [Piranha Rush] Implement the bot opponent with three difficulty tiers
- #1115 [Piranha Rush] Create original art and wire the audio events
- #1116 [Piranha Rush] Write unit and deterministic simulation tests
- #1117 [Piranha Rush] QA pass against the definition of done

### pizza-memory (15)

- #1013 [Pizza Memory] Build the game
- #1014 [Pizza Memory] Research: play the reference genre and document observed mechanics
- #1015 [Pizza Memory] Write the game spec
- #1016 [Pizza Memory] Scaffold the game package and manifest
- #1017 [Pizza Memory] Implement the state model and rules module
- #1018 [Pizza Memory] Wire up controls for both seats
- #1019 [Pizza Memory] Implement the core simulation
- #1020 [Pizza Memory] Implement scoring and the win condition
- #1021 [Pizza Memory] Implement rendering
- #1022 [Pizza Memory] Implement the split-seat layout and per-seat HUD placement
- #1023 [Pizza Memory] Integrate the shared match flow
- #1024 [Pizza Memory] Implement the bot opponent with three difficulty tiers
- #1025 [Pizza Memory] Create original art and wire the audio events
- #1026 [Pizza Memory] Write unit and deterministic simulation tests
- #1027 [Pizza Memory] QA pass against the definition of done

### pool (15)

- #518 [Pool] Build the game
- #519 [Pool] Research: play the reference genre and document observed mechanics
- #520 [Pool] Write the game spec
- #521 [Pool] Scaffold the game package and manifest
- #522 [Pool] Implement the state model and rules module
- #523 [Pool] Wire up controls for both seats
- #524 [Pool] Implement the core simulation
- #525 [Pool] Implement scoring and the win condition
- #526 [Pool] Implement rendering
- #527 [Pool] Integrate seat rotation and the turn indicator
- #528 [Pool] Integrate the shared match flow
- #529 [Pool] Implement the bot opponent with three difficulty tiers
- #530 [Pool] Create original art and wire the audio events
- #531 [Pool] Write unit and deterministic simulation tests
- #532 [Pool] QA pass against the definition of done

### pop-it (15)

- #983 [Pop It] Build the game
- #984 [Pop It] Research: play the reference genre and document observed mechanics
- #985 [Pop It] Write the game spec
- #986 [Pop It] Scaffold the game package and manifest
- #987 [Pop It] Implement the state model and rules module
- #988 [Pop It] Wire up controls for both seats
- #989 [Pop It] Implement the core simulation
- #990 [Pop It] Implement scoring and the win condition
- #991 [Pop It] Implement rendering
- #992 [Pop It] Implement the split-seat layout and per-seat HUD placement
- #993 [Pop It] Integrate the shared match flow
- #994 [Pop It] Implement the bot opponent with three difficulty tiers
- #995 [Pop It] Create original art and wire the audio events
- #996 [Pop It] Write unit and deterministic simulation tests
- #997 [Pop It] QA pass against the definition of done

### pull-the-rope (15)

- #923 [Pull the Rope] Build the game
- #924 [Pull the Rope] Research: play the reference genre and document observed mechanics
- #925 [Pull the Rope] Write the game spec
- #926 [Pull the Rope] Scaffold the game package and manifest
- #927 [Pull the Rope] Implement the state model and rules module
- #928 [Pull the Rope] Wire up controls for both seats
- #929 [Pull the Rope] Implement the core simulation
- #930 [Pull the Rope] Implement scoring and the win condition
- #931 [Pull the Rope] Implement rendering
- #932 [Pull the Rope] Implement the split-seat layout and per-seat HUD placement
- #933 [Pull the Rope] Integrate the shared match flow
- #934 [Pull the Rope] Implement the bot opponent with three difficulty tiers
- #935 [Pull the Rope] Create original art and wire the audio events
- #936 [Pull the Rope] Write unit and deterministic simulation tests
- #937 [Pull the Rope] QA pass against the definition of done

### racing-cars (15)

- #1538 [Racing Cars] Build the game
- #1539 [Racing Cars] Research: play the reference genre and document observed mechanics
- #1540 [Racing Cars] Write the game spec
- #1541 [Racing Cars] Scaffold the game package and manifest
- #1542 [Racing Cars] Implement the state model and rules module
- #1543 [Racing Cars] Wire up controls for both seats
- #1544 [Racing Cars] Implement the core simulation
- #1545 [Racing Cars] Implement scoring and the win condition
- #1546 [Racing Cars] Implement rendering
- #1547 [Racing Cars] Implement the split-seat layout and per-seat HUD placement
- #1548 [Racing Cars] Integrate the shared match flow
- #1549 [Racing Cars] Implement the bot opponent with three difficulty tiers
- #1550 [Racing Cars] Create original art and wire the audio events
- #1551 [Racing Cars] Write unit and deterministic simulation tests
- #1552 [Racing Cars] QA pass against the definition of done

### rat-race (15)

- #1583 [Rat Race] Build the game
- #1584 [Rat Race] Research: play the reference genre and document observed mechanics
- #1585 [Rat Race] Write the game spec
- #1586 [Rat Race] Scaffold the game package and manifest
- #1587 [Rat Race] Implement the state model and rules module
- #1588 [Rat Race] Wire up controls for both seats
- #1589 [Rat Race] Implement the core simulation
- #1590 [Rat Race] Implement scoring and the win condition
- #1591 [Rat Race] Implement rendering
- #1592 [Rat Race] Implement the split-seat layout and per-seat HUD placement
- #1593 [Rat Race] Integrate the shared match flow
- #1594 [Rat Race] Implement the bot opponent with three difficulty tiers
- #1595 [Rat Race] Create original art and wire the audio events
- #1596 [Rat Race] Write unit and deterministic simulation tests
- #1597 [Rat Race] QA pass against the definition of done

### reversi (15)

- #323 [Reversi] Build the game
- #324 [Reversi] Research: play the reference genre and document observed mechanics
- #325 [Reversi] Write the game spec
- #326 [Reversi] Scaffold the game package and manifest
- #327 [Reversi] Implement the state model and rules module
- #328 [Reversi] Wire up controls for both seats
- #329 [Reversi] Implement the core simulation
- #330 [Reversi] Implement scoring and the win condition
- #331 [Reversi] Implement rendering
- #332 [Reversi] Integrate seat rotation and the turn indicator
- #333 [Reversi] Integrate the shared match flow
- #334 [Reversi] Implement the bot opponent with three difficulty tiers
- #335 [Reversi] Create original art and wire the audio events
- #336 [Reversi] Write unit and deterministic simulation tests
- #337 [Reversi] QA pass against the definition of done

### road-dodge (15)

- #1628 [Road Dodge] Build the game
- #1629 [Road Dodge] Research: play the reference genre and document observed mechanics
- #1630 [Road Dodge] Write the game spec
- #1631 [Road Dodge] Scaffold the game package and manifest
- #1632 [Road Dodge] Implement the state model and rules module
- #1633 [Road Dodge] Wire up controls for both seats
- #1634 [Road Dodge] Implement the core simulation
- #1635 [Road Dodge] Implement scoring and the win condition
- #1636 [Road Dodge] Implement rendering
- #1637 [Road Dodge] Implement the split-seat layout and per-seat HUD placement
- #1638 [Road Dodge] Integrate the shared match flow
- #1639 [Road Dodge] Implement the bot opponent with three difficulty tiers
- #1640 [Road Dodge] Create original art and wire the audio events
- #1641 [Road Dodge] Write unit and deterministic simulation tests
- #1642 [Road Dodge] QA pass against the definition of done

### robot-arena (15)

- #1815 [Robot Arena] Build the game
- #1816 [Robot Arena] Research: play the reference genre and document observed mechanics
- #1817 [Robot Arena] Write the game spec
- #1818 [Robot Arena] Scaffold the game package and manifest
- #1819 [Robot Arena] Implement the state model and rules module
- #1820 [Robot Arena] Wire up controls for both seats
- #1821 [Robot Arena] Implement the core simulation
- #1822 [Robot Arena] Implement scoring and the win condition
- #1823 [Robot Arena] Implement rendering
- #1824 [Robot Arena] Implement the split-seat layout and per-seat HUD placement
- #1825 [Robot Arena] Integrate the shared match flow
- #1826 [Robot Arena] Implement the bot opponent with three difficulty tiers
- #1827 [Robot Arena] Create original art and wire the audio events
- #1828 [Robot Arena] Write unit and deterministic simulation tests
- #1829 [Robot Arena] QA pass against the definition of done

### rock-paper-scissors (15)

- #953 [Rock Paper Scissors] Build the game
- #954 [Rock Paper Scissors] Research: play the reference genre and document observed mechanics
- #955 [Rock Paper Scissors] Write the game spec
- #956 [Rock Paper Scissors] Scaffold the game package and manifest
- #957 [Rock Paper Scissors] Implement the state model and rules module
- #958 [Rock Paper Scissors] Wire up controls for both seats
- #959 [Rock Paper Scissors] Implement the core simulation
- #960 [Rock Paper Scissors] Implement scoring and the win condition
- #961 [Rock Paper Scissors] Implement rendering
- #962 [Rock Paper Scissors] Implement the split-seat layout and per-seat HUD placement
- #963 [Rock Paper Scissors] Integrate the shared match flow
- #964 [Rock Paper Scissors] Implement the bot opponent with three difficulty tiers
- #965 [Rock Paper Scissors] Create original art and wire the audio events
- #966 [Rock Paper Scissors] Write unit and deterministic simulation tests
- #967 [Rock Paper Scissors] QA pass against the definition of done

### sea-battle (15)

- #413 [Sea Battle] Build the game
- #414 [Sea Battle] Research: play the reference genre and document observed mechanics
- #415 [Sea Battle] Write the game spec
- #416 [Sea Battle] Scaffold the game package and manifest
- #417 [Sea Battle] Implement the state model and rules module
- #418 [Sea Battle] Wire up controls for both seats
- #419 [Sea Battle] Implement the core simulation
- #420 [Sea Battle] Implement scoring and the win condition
- #421 [Sea Battle] Implement rendering
- #422 [Sea Battle] Integrate seat rotation and the turn indicator
- #423 [Sea Battle] Integrate the shared match flow
- #424 [Sea Battle] Implement the bot opponent with three difficulty tiers
- #425 [Sea Battle] Create original art and wire the audio events
- #426 [Sea Battle] Write unit and deterministic simulation tests
- #427 [Sea Battle] QA pass against the definition of done

### ship-battle (15)

- #428 [Ship Battle] Build the game
- #429 [Ship Battle] Research: play the reference genre and document observed mechanics
- #430 [Ship Battle] Write the game spec
- #431 [Ship Battle] Scaffold the game package and manifest
- #432 [Ship Battle] Implement the state model and rules module
- #433 [Ship Battle] Wire up controls for both seats
- #434 [Ship Battle] Implement the core simulation
- #435 [Ship Battle] Implement scoring and the win condition
- #436 [Ship Battle] Implement rendering
- #437 [Ship Battle] Integrate seat rotation and the turn indicator
- #438 [Ship Battle] Integrate the shared match flow
- #439 [Ship Battle] Implement the bot opponent with three difficulty tiers
- #440 [Ship Battle] Create original art and wire the audio events
- #441 [Ship Battle] Write unit and deterministic simulation tests
- #442 [Ship Battle] QA pass against the definition of done

### shuriken (15)

- #698 [Shuriken] Build the game
- #699 [Shuriken] Research: play the reference genre and document observed mechanics
- #700 [Shuriken] Write the game spec
- #701 [Shuriken] Scaffold the game package and manifest
- #702 [Shuriken] Implement the state model and rules module
- #703 [Shuriken] Wire up controls for both seats
- #704 [Shuriken] Implement the core simulation
- #705 [Shuriken] Implement scoring and the win condition
- #706 [Shuriken] Implement rendering
- #707 [Shuriken] Integrate seat rotation and the turn indicator
- #708 [Shuriken] Integrate the shared match flow
- #709 [Shuriken] Implement the bot opponent with three difficulty tiers
- #710 [Shuriken] Create original art and wire the audio events
- #711 [Shuriken] Write unit and deterministic simulation tests
- #712 [Shuriken] QA pass against the definition of done

### shut-the-box (15)

- #443 [Shut the Box] Build the game
- #444 [Shut the Box] Research: play the reference genre and document observed mechanics
- #445 [Shut the Box] Write the game spec
- #446 [Shut the Box] Scaffold the game package and manifest
- #447 [Shut the Box] Implement the state model and rules module
- #448 [Shut the Box] Wire up controls for both seats
- #449 [Shut the Box] Implement the core simulation
- #450 [Shut the Box] Implement scoring and the win condition
- #451 [Shut the Box] Implement rendering
- #452 [Shut the Box] Integrate seat rotation and the turn indicator
- #453 [Shut the Box] Integrate the shared match flow
- #454 [Shut the Box] Implement the bot opponent with three difficulty tiers
- #455 [Shut the Box] Create original art and wire the audio events
- #456 [Shut the Box] Write unit and deterministic simulation tests
- #457 [Shut the Box] QA pass against the definition of done

### sliding-puzzle (13)

- #1684 [Sliding Puzzle] Build the game
- #1685 [Sliding Puzzle] Research: play the reference genre and document observed mechanics
- #1686 [Sliding Puzzle] Write the game spec
- #1687 [Sliding Puzzle] Scaffold the game package and manifest
- #1688 [Sliding Puzzle] Implement the state model and rules module
- #1689 [Sliding Puzzle] Wire up controls for both seats
- #1690 [Sliding Puzzle] Implement the core simulation
- #1691 [Sliding Puzzle] Implement scoring and the win condition
- #1692 [Sliding Puzzle] Implement rendering
- #1693 [Sliding Puzzle] Integrate the shared match flow
- #1694 [Sliding Puzzle] Create original art and wire the audio events
- #1695 [Sliding Puzzle] Write unit and deterministic simulation tests
- #1696 [Sliding Puzzle] QA pass against the definition of done

### sling-puck (15)

- #593 [Sling Puck] Build the game
- #594 [Sling Puck] Research: play the reference genre and document observed mechanics
- #595 [Sling Puck] Write the game spec
- #596 [Sling Puck] Scaffold the game package and manifest
- #597 [Sling Puck] Implement the state model and rules module
- #598 [Sling Puck] Wire up controls for both seats
- #599 [Sling Puck] Implement the core simulation
- #600 [Sling Puck] Implement scoring and the win condition
- #601 [Sling Puck] Implement rendering
- #602 [Sling Puck] Integrate seat rotation and the turn indicator
- #603 [Sling Puck] Integrate the shared match flow
- #604 [Sling Puck] Implement the bot opponent with three difficulty tiers
- #605 [Sling Puck] Create original art and wire the audio events
- #606 [Sling Puck] Write unit and deterministic simulation tests
- #607 [Sling Puck] QA pass against the definition of done

### slot-cars (15)

- #1568 [Slot Cars] Build the game
- #1569 [Slot Cars] Research: play the reference genre and document observed mechanics
- #1570 [Slot Cars] Write the game spec
- #1571 [Slot Cars] Scaffold the game package and manifest
- #1572 [Slot Cars] Implement the state model and rules module
- #1573 [Slot Cars] Wire up controls for both seats
- #1574 [Slot Cars] Implement the core simulation
- #1575 [Slot Cars] Implement scoring and the win condition
- #1576 [Slot Cars] Implement rendering
- #1577 [Slot Cars] Implement the split-seat layout and per-seat HUD placement
- #1578 [Slot Cars] Integrate the shared match flow
- #1579 [Slot Cars] Implement the bot opponent with three difficulty tiers
- #1580 [Slot Cars] Create original art and wire the audio events
- #1581 [Slot Cars] Write unit and deterministic simulation tests
- #1582 [Slot Cars] QA pass against the definition of done

### snakes (15)

- #1845 [Snake Clash] Build the game
- #1846 [Snake Clash] Research: play the reference genre and document observed mechanics
- #1847 [Snake Clash] Write the game spec
- #1848 [Snake Clash] Scaffold the game package and manifest
- #1849 [Snake Clash] Implement the state model and rules module
- #1850 [Snake Clash] Wire up controls for both seats
- #1851 [Snake Clash] Implement the core simulation
- #1852 [Snake Clash] Implement scoring and the win condition
- #1853 [Snake Clash] Implement rendering
- #1854 [Snake Clash] Implement the split-seat layout and per-seat HUD placement
- #1855 [Snake Clash] Integrate the shared match flow
- #1856 [Snake Clash] Implement the bot opponent with three difficulty tiers
- #1857 [Snake Clash] Create original art and wire the audio events
- #1858 [Snake Clash] Write unit and deterministic simulation tests
- #1859 [Snake Clash] QA pass against the definition of done

### snakes-ladders (15)

- #398 [Snakes and Ladders] Build the game
- #399 [Snakes and Ladders] Research: play the reference genre and document observed mechanics
- #400 [Snakes and Ladders] Write the game spec
- #401 [Snakes and Ladders] Scaffold the game package and manifest
- #402 [Snakes and Ladders] Implement the state model and rules module
- #403 [Snakes and Ladders] Wire up controls for both seats
- #404 [Snakes and Ladders] Implement the core simulation
- #405 [Snakes and Ladders] Implement scoring and the win condition
- #406 [Snakes and Ladders] Implement rendering
- #407 [Snakes and Ladders] Integrate seat rotation and the turn indicator
- #408 [Snakes and Ladders] Integrate the shared match flow
- #409 [Snakes and Ladders] Implement the bot opponent with three difficulty tiers
- #410 [Snakes and Ladders] Create original art and wire the audio events
- #411 [Snakes and Ladders] Write unit and deterministic simulation tests
- #412 [Snakes and Ladders] QA pass against the definition of done

### soccer-pool (15)

- #608 [Soccer Pool] Build the game
- #609 [Soccer Pool] Research: play the reference genre and document observed mechanics
- #610 [Soccer Pool] Write the game spec
- #611 [Soccer Pool] Scaffold the game package and manifest
- #612 [Soccer Pool] Implement the state model and rules module
- #613 [Soccer Pool] Wire up controls for both seats
- #614 [Soccer Pool] Implement the core simulation
- #615 [Soccer Pool] Implement scoring and the win condition
- #616 [Soccer Pool] Implement rendering
- #617 [Soccer Pool] Integrate seat rotation and the turn indicator
- #618 [Soccer Pool] Integrate the shared match flow
- #619 [Soccer Pool] Implement the bot opponent with three difficulty tiers
- #620 [Soccer Pool] Create original art and wire the audio events
- #621 [Soccer Pool] Write unit and deterministic simulation tests
- #622 [Soccer Pool] QA pass against the definition of done

### solitaire (13)

- #1658 [Solitaire] Build the game
- #1659 [Solitaire] Research: play the reference genre and document observed mechanics
- #1660 [Solitaire] Write the game spec
- #1661 [Solitaire] Scaffold the game package and manifest
- #1662 [Solitaire] Implement the state model and rules module
- #1663 [Solitaire] Wire up controls for both seats
- #1664 [Solitaire] Implement the core simulation
- #1665 [Solitaire] Implement scoring and the win condition
- #1666 [Solitaire] Implement rendering
- #1667 [Solitaire] Integrate the shared match flow
- #1668 [Solitaire] Create original art and wire the audio events
- #1669 [Solitaire] Write unit and deterministic simulation tests
- #1670 [Solitaire] QA pass against the definition of done

### spike-attacks (15)

- #1343 [Spike Attacks] Build the game
- #1344 [Spike Attacks] Research: play the reference genre and document observed mechanics
- #1345 [Spike Attacks] Write the game spec
- #1346 [Spike Attacks] Scaffold the game package and manifest
- #1347 [Spike Attacks] Implement the state model and rules module
- #1348 [Spike Attacks] Wire up controls for both seats
- #1349 [Spike Attacks] Implement the core simulation
- #1350 [Spike Attacks] Implement scoring and the win condition
- #1351 [Spike Attacks] Implement rendering
- #1352 [Spike Attacks] Implement the split-seat layout and per-seat HUD placement
- #1353 [Spike Attacks] Integrate the shared match flow
- #1354 [Spike Attacks] Implement the bot opponent with three difficulty tiers
- #1355 [Spike Attacks] Create original art and wire the audio events
- #1356 [Spike Attacks] Write unit and deterministic simulation tests
- #1357 [Spike Attacks] QA pass against the definition of done

### spin-war (15)

- #1770 [Spin War] Build the game
- #1771 [Spin War] Research: play the reference genre and document observed mechanics
- #1772 [Spin War] Write the game spec
- #1773 [Spin War] Scaffold the game package and manifest
- #1774 [Spin War] Implement the state model and rules module
- #1775 [Spin War] Wire up controls for both seats
- #1776 [Spin War] Implement the core simulation
- #1777 [Spin War] Implement scoring and the win condition
- #1778 [Spin War] Implement rendering
- #1779 [Spin War] Implement the split-seat layout and per-seat HUD placement
- #1780 [Spin War] Integrate the shared match flow
- #1781 [Spin War] Implement the bot opponent with three difficulty tiers
- #1782 [Spin War] Create original art and wire the audio events
- #1783 [Spin War] Write unit and deterministic simulation tests
- #1784 [Spin War] QA pass against the definition of done

### stampede (15)

- #1328 [Stampede] Build the game
- #1329 [Stampede] Research: play the reference genre and document observed mechanics
- #1330 [Stampede] Write the game spec
- #1331 [Stampede] Scaffold the game package and manifest
- #1332 [Stampede] Implement the state model and rules module
- #1333 [Stampede] Wire up controls for both seats
- #1334 [Stampede] Implement the core simulation
- #1335 [Stampede] Implement scoring and the win condition
- #1336 [Stampede] Implement rendering
- #1337 [Stampede] Implement the split-seat layout and per-seat HUD placement
- #1338 [Stampede] Integrate the shared match flow
- #1339 [Stampede] Implement the bot opponent with three difficulty tiers
- #1340 [Stampede] Create original art and wire the audio events
- #1341 [Stampede] Write unit and deterministic simulation tests
- #1342 [Stampede] QA pass against the definition of done

### star-catcher (15)

- #1133 [Star Catcher] Build the game
- #1134 [Star Catcher] Research: play the reference genre and document observed mechanics
- #1135 [Star Catcher] Write the game spec
- #1136 [Star Catcher] Scaffold the game package and manifest
- #1137 [Star Catcher] Implement the state model and rules module
- #1138 [Star Catcher] Wire up controls for both seats
- #1139 [Star Catcher] Implement the core simulation
- #1140 [Star Catcher] Implement scoring and the win condition
- #1141 [Star Catcher] Implement rendering
- #1142 [Star Catcher] Implement the split-seat layout and per-seat HUD placement
- #1143 [Star Catcher] Integrate the shared match flow
- #1144 [Star Catcher] Implement the bot opponent with three difficulty tiers
- #1145 [Star Catcher] Create original art and wire the audio events
- #1146 [Star Catcher] Write unit and deterministic simulation tests
- #1147 [Star Catcher] QA pass against the definition of done

### sticky-tongues (15)

- #1058 [Sticky Tongues] Build the game
- #1059 [Sticky Tongues] Research: play the reference genre and document observed mechanics
- #1060 [Sticky Tongues] Write the game spec
- #1061 [Sticky Tongues] Scaffold the game package and manifest
- #1062 [Sticky Tongues] Implement the state model and rules module
- #1063 [Sticky Tongues] Wire up controls for both seats
- #1064 [Sticky Tongues] Implement the core simulation
- #1065 [Sticky Tongues] Implement scoring and the win condition
- #1066 [Sticky Tongues] Implement rendering
- #1067 [Sticky Tongues] Implement the split-seat layout and per-seat HUD placement
- #1068 [Sticky Tongues] Integrate the shared match flow
- #1069 [Sticky Tongues] Implement the bot opponent with three difficulty tiers
- #1070 [Sticky Tongues] Create original art and wire the audio events
- #1071 [Sticky Tongues] Write unit and deterministic simulation tests
- #1072 [Sticky Tongues] QA pass against the definition of done

### sudoku (13)

- #1671 [Sudoku] Build the game
- #1672 [Sudoku] Research: play the reference genre and document observed mechanics
- #1673 [Sudoku] Write the game spec
- #1674 [Sudoku] Scaffold the game package and manifest
- #1675 [Sudoku] Implement the state model and rules module
- #1676 [Sudoku] Wire up controls for both seats
- #1677 [Sudoku] Implement the core simulation
- #1678 [Sudoku] Implement scoring and the win condition
- #1679 [Sudoku] Implement rendering
- #1680 [Sudoku] Integrate the shared match flow
- #1681 [Sudoku] Create original art and wire the audio events
- #1682 [Sudoku] Write unit and deterministic simulation tests
- #1683 [Sudoku] QA pass against the definition of done

### sumo (15)

- #1388 [Sumo Push] Build the game
- #1389 [Sumo Push] Research: play the reference genre and document observed mechanics
- #1390 [Sumo Push] Write the game spec
- #1391 [Sumo Push] Scaffold the game package and manifest
- #1392 [Sumo Push] Implement the state model and rules module
- #1393 [Sumo Push] Wire up controls for both seats
- #1394 [Sumo Push] Implement the core simulation
- #1395 [Sumo Push] Implement scoring and the win condition
- #1396 [Sumo Push] Implement rendering
- #1397 [Sumo Push] Implement the split-seat layout and per-seat HUD placement
- #1398 [Sumo Push] Integrate the shared match flow
- #1399 [Sumo Push] Implement the bot opponent with three difficulty tiers
- #1400 [Sumo Push] Create original art and wire the audio events
- #1401 [Sumo Push] Write unit and deterministic simulation tests
- #1402 [Sumo Push] QA pass against the definition of done

### sword-throwing (15)

- #683 [Sword Throwing] Build the game
- #684 [Sword Throwing] Research: play the reference genre and document observed mechanics
- #685 [Sword Throwing] Write the game spec
- #686 [Sword Throwing] Scaffold the game package and manifest
- #687 [Sword Throwing] Implement the state model and rules module
- #688 [Sword Throwing] Wire up controls for both seats
- #689 [Sword Throwing] Implement the core simulation
- #690 [Sword Throwing] Implement scoring and the win condition
- #691 [Sword Throwing] Implement rendering
- #692 [Sword Throwing] Integrate seat rotation and the turn indicator
- #693 [Sword Throwing] Integrate the shared match flow
- #694 [Sword Throwing] Implement the bot opponent with three difficulty tiers
- #695 [Sword Throwing] Create original art and wire the audio events
- #696 [Sword Throwing] Write unit and deterministic simulation tests
- #697 [Sword Throwing] QA pass against the definition of done

### tanks (15)

- #773 [Tanks] Build the game
- #774 [Tanks] Research: play the reference genre and document observed mechanics
- #775 [Tanks] Write the game spec
- #776 [Tanks] Scaffold the game package and manifest
- #777 [Tanks] Implement the state model and rules module
- #778 [Tanks] Wire up controls for both seats
- #779 [Tanks] Implement the core simulation
- #780 [Tanks] Implement scoring and the win condition
- #781 [Tanks] Implement rendering
- #782 [Tanks] Integrate seat rotation and the turn indicator
- #783 [Tanks] Integrate the shared match flow
- #784 [Tanks] Implement the bot opponent with three difficulty tiers
- #785 [Tanks] Create original art and wire the audio events
- #786 [Tanks] Write unit and deterministic simulation tests
- #787 [Tanks] QA pass against the definition of done

### tap-match (13)

- #1710 [Tap Match] Build the game
- #1711 [Tap Match] Research: play the reference genre and document observed mechanics
- #1712 [Tap Match] Write the game spec
- #1713 [Tap Match] Scaffold the game package and manifest
- #1714 [Tap Match] Implement the state model and rules module
- #1715 [Tap Match] Wire up controls for both seats
- #1716 [Tap Match] Implement the core simulation
- #1717 [Tap Match] Implement scoring and the win condition
- #1718 [Tap Match] Implement rendering
- #1719 [Tap Match] Integrate the shared match flow
- #1720 [Tap Match] Create original art and wire the audio events
- #1721 [Tap Match] Write unit and deterministic simulation tests
- #1722 [Tap Match] QA pass against the definition of done

### target-practice (15)

- #743 [Target Practice] Build the game
- #744 [Target Practice] Research: play the reference genre and document observed mechanics
- #745 [Target Practice] Write the game spec
- #746 [Target Practice] Scaffold the game package and manifest
- #747 [Target Practice] Implement the state model and rules module
- #748 [Target Practice] Wire up controls for both seats
- #749 [Target Practice] Implement the core simulation
- #750 [Target Practice] Implement scoring and the win condition
- #751 [Target Practice] Implement rendering
- #752 [Target Practice] Integrate seat rotation and the turn indicator
- #753 [Target Practice] Integrate the shared match flow
- #754 [Target Practice] Implement the bot opponent with three difficulty tiers
- #755 [Target Practice] Create original art and wire the audio events
- #756 [Target Practice] Write unit and deterministic simulation tests
- #757 [Target Practice] QA pass against the definition of done

### taxi-race (15)

- #1553 [Taxi Race] Build the game
- #1554 [Taxi Race] Research: play the reference genre and document observed mechanics
- #1555 [Taxi Race] Write the game spec
- #1556 [Taxi Race] Scaffold the game package and manifest
- #1557 [Taxi Race] Implement the state model and rules module
- #1558 [Taxi Race] Wire up controls for both seats
- #1559 [Taxi Race] Implement the core simulation
- #1560 [Taxi Race] Implement scoring and the win condition
- #1561 [Taxi Race] Implement rendering
- #1562 [Taxi Race] Implement the split-seat layout and per-seat HUD placement
- #1563 [Taxi Race] Integrate the shared match flow
- #1564 [Taxi Race] Implement the bot opponent with three difficulty tiers
- #1565 [Taxi Race] Create original art and wire the audio events
- #1566 [Taxi Race] Write unit and deterministic simulation tests
- #1567 [Taxi Race] QA pass against the definition of done

### tennis (15)

- #833 [Tennis] Build the game
- #834 [Tennis] Research: play the reference genre and document observed mechanics
- #835 [Tennis] Write the game spec
- #836 [Tennis] Scaffold the game package and manifest
- #837 [Tennis] Implement the state model and rules module
- #838 [Tennis] Wire up controls for both seats
- #839 [Tennis] Implement the core simulation
- #840 [Tennis] Implement scoring and the win condition
- #841 [Tennis] Implement rendering
- #842 [Tennis] Implement the split-seat layout and per-seat HUD placement
- #843 [Tennis] Integrate the shared match flow
- #844 [Tennis] Implement the bot opponent with three difficulty tiers
- #845 [Tennis] Create original art and wire the audio events
- #846 [Tennis] Write unit and deterministic simulation tests
- #847 [Tennis] QA pass against the definition of done

### the-last-sashimi (15)

- #803 [The Last Sashimi] Build the game
- #804 [The Last Sashimi] Research: play the reference genre and document observed mechanics
- #805 [The Last Sashimi] Write the game spec
- #806 [The Last Sashimi] Scaffold the game package and manifest
- #807 [The Last Sashimi] Implement the state model and rules module
- #808 [The Last Sashimi] Wire up controls for both seats
- #809 [The Last Sashimi] Implement the core simulation
- #810 [The Last Sashimi] Implement scoring and the win condition
- #811 [The Last Sashimi] Implement rendering
- #812 [The Last Sashimi] Integrate seat rotation and the turn indicator
- #813 [The Last Sashimi] Integrate the shared match flow
- #814 [The Last Sashimi] Implement the bot opponent with three difficulty tiers
- #815 [The Last Sashimi] Create original art and wire the audio events
- #816 [The Last Sashimi] Write unit and deterministic simulation tests
- #817 [The Last Sashimi] QA pass against the definition of done

### throw (15)

- #908 [Snowball Throw] Build the game
- #909 [Snowball Throw] Research: play the reference genre and document observed mechanics
- #910 [Snowball Throw] Write the game spec
- #911 [Snowball Throw] Scaffold the game package and manifest
- #912 [Snowball Throw] Implement the state model and rules module
- #913 [Snowball Throw] Wire up controls for both seats
- #914 [Snowball Throw] Implement the core simulation
- #915 [Snowball Throw] Implement scoring and the win condition
- #916 [Snowball Throw] Implement rendering
- #917 [Snowball Throw] Implement the split-seat layout and per-seat HUD placement
- #918 [Snowball Throw] Integrate the shared match flow
- #919 [Snowball Throw] Implement the bot opponent with three difficulty tiers
- #920 [Snowball Throw] Create original art and wire the audio events
- #921 [Snowball Throw] Write unit and deterministic simulation tests
- #922 [Snowball Throw] QA pass against the definition of done

### tic-tac-toe (15)

- #248 [Tic Tac Toe] Build the game
- #249 [Tic Tac Toe] Research: play the reference genre and document observed mechanics
- #250 [Tic Tac Toe] Write the game spec
- #251 [Tic Tac Toe] Scaffold the game package and manifest
- #252 [Tic Tac Toe] Implement the state model and rules module
- #253 [Tic Tac Toe] Wire up controls for both seats
- #254 [Tic Tac Toe] Implement the core simulation
- #255 [Tic Tac Toe] Implement scoring and the win condition
- #256 [Tic Tac Toe] Implement rendering
- #257 [Tic Tac Toe] Integrate seat rotation and the turn indicator
- #258 [Tic Tac Toe] Integrate the shared match flow
- #259 [Tic Tac Toe] Implement the bot opponent with three difficulty tiers
- #260 [Tic Tac Toe] Create original art and wire the audio events
- #261 [Tic Tac Toe] Write unit and deterministic simulation tests
- #262 [Tic Tac Toe] QA pass against the definition of done

### traffic-jam (15)

- #1643 [Traffic Jam] Build the game
- #1644 [Traffic Jam] Research: play the reference genre and document observed mechanics
- #1645 [Traffic Jam] Write the game spec
- #1646 [Traffic Jam] Scaffold the game package and manifest
- #1647 [Traffic Jam] Implement the state model and rules module
- #1648 [Traffic Jam] Wire up controls for both seats
- #1649 [Traffic Jam] Implement the core simulation
- #1650 [Traffic Jam] Implement scoring and the win condition
- #1651 [Traffic Jam] Implement rendering
- #1652 [Traffic Jam] Implement the split-seat layout and per-seat HUD placement
- #1653 [Traffic Jam] Integrate the shared match flow
- #1654 [Traffic Jam] Implement the bot opponent with three difficulty tiers
- #1655 [Traffic Jam] Create original art and wire the audio events
- #1656 [Traffic Jam] Write unit and deterministic simulation tests
- #1657 [Traffic Jam] QA pass against the definition of done

### ultimate-ttt (15)

- #263 [Ultimate Tic Tac Toe] Build the game
- #264 [Ultimate Tic Tac Toe] Research: play the reference genre and document observed mechanics
- #265 [Ultimate Tic Tac Toe] Write the game spec
- #266 [Ultimate Tic Tac Toe] Scaffold the game package and manifest
- #267 [Ultimate Tic Tac Toe] Implement the state model and rules module
- #268 [Ultimate Tic Tac Toe] Wire up controls for both seats
- #269 [Ultimate Tic Tac Toe] Implement the core simulation
- #270 [Ultimate Tic Tac Toe] Implement scoring and the win condition
- #271 [Ultimate Tic Tac Toe] Implement rendering
- #272 [Ultimate Tic Tac Toe] Integrate seat rotation and the turn indicator
- #273 [Ultimate Tic Tac Toe] Integrate the shared match flow
- #274 [Ultimate Tic Tac Toe] Implement the bot opponent with three difficulty tiers
- #275 [Ultimate Tic Tac Toe] Create original art and wire the audio events
- #276 [Ultimate Tic Tac Toe] Write unit and deterministic simulation tests
- #277 [Ultimate Tic Tac Toe] QA pass against the definition of done

### unfair-fishing (15)

- #1118 [Unfair Fishing] Build the game
- #1119 [Unfair Fishing] Research: play the reference genre and document observed mechanics
- #1120 [Unfair Fishing] Write the game spec
- #1121 [Unfair Fishing] Scaffold the game package and manifest
- #1122 [Unfair Fishing] Implement the state model and rules module
- #1123 [Unfair Fishing] Wire up controls for both seats
- #1124 [Unfair Fishing] Implement the core simulation
- #1125 [Unfair Fishing] Implement scoring and the win condition
- #1126 [Unfair Fishing] Implement rendering
- #1127 [Unfair Fishing] Implement the split-seat layout and per-seat HUD placement
- #1128 [Unfair Fishing] Integrate the shared match flow
- #1129 [Unfair Fishing] Implement the bot opponent with three difficulty tiers
- #1130 [Unfair Fishing] Create original art and wire the audio events
- #1131 [Unfair Fishing] Write unit and deterministic simulation tests
- #1132 [Unfair Fishing] QA pass against the definition of done

### water-game (15)

- #1193 [Water Game] Build the game
- #1194 [Water Game] Research: play the reference genre and document observed mechanics
- #1195 [Water Game] Write the game spec
- #1196 [Water Game] Scaffold the game package and manifest
- #1197 [Water Game] Implement the state model and rules module
- #1198 [Water Game] Wire up controls for both seats
- #1199 [Water Game] Implement the core simulation
- #1200 [Water Game] Implement scoring and the win condition
- #1201 [Water Game] Implement rendering
- #1202 [Water Game] Implement the split-seat layout and per-seat HUD placement
- #1203 [Water Game] Integrate the shared match flow
- #1204 [Water Game] Implement the bot opponent with three difficulty tiers
- #1205 [Water Game] Create original art and wire the audio events
- #1206 [Water Game] Write unit and deterministic simulation tests
- #1207 [Water Game] QA pass against the definition of done

### whack (15)

- #1508 [Whack Attack] Build the game
- #1509 [Whack Attack] Research: play the reference genre and document observed mechanics
- #1510 [Whack Attack] Write the game spec
- #1511 [Whack Attack] Scaffold the game package and manifest
- #1512 [Whack Attack] Implement the state model and rules module
- #1513 [Whack Attack] Wire up controls for both seats
- #1514 [Whack Attack] Implement the core simulation
- #1515 [Whack Attack] Implement scoring and the win condition
- #1516 [Whack Attack] Implement rendering
- #1517 [Whack Attack] Implement the split-seat layout and per-seat HUD placement
- #1518 [Whack Attack] Integrate the shared match flow
- #1519 [Whack Attack] Implement the bot opponent with three difficulty tiers
- #1520 [Whack Attack] Create original art and wire the audio events
- #1521 [Whack Attack] Write unit and deterministic simulation tests
- #1522 [Whack Attack] QA pass against the definition of done

### whack-a-mole (15)

- #1785 [Whack a Mole] Build the game
- #1786 [Whack a Mole] Research: play the reference genre and document observed mechanics
- #1787 [Whack a Mole] Write the game spec
- #1788 [Whack a Mole] Scaffold the game package and manifest
- #1789 [Whack a Mole] Implement the state model and rules module
- #1790 [Whack a Mole] Wire up controls for both seats
- #1791 [Whack a Mole] Implement the core simulation
- #1792 [Whack a Mole] Implement scoring and the win condition
- #1793 [Whack a Mole] Implement rendering
- #1794 [Whack a Mole] Implement the split-seat layout and per-seat HUD placement
- #1795 [Whack a Mole] Integrate the shared match flow
- #1796 [Whack a Mole] Implement the bot opponent with three difficulty tiers
- #1797 [Whack a Mole] Create original art and wire the audio events
- #1798 [Whack a Mole] Write unit and deterministic simulation tests
- #1799 [Whack a Mole] QA pass against the definition of done

### wheelie (15)

- #1598 [Wheelie] Build the game
- #1599 [Wheelie] Research: play the reference genre and document observed mechanics
- #1600 [Wheelie] Write the game spec
- #1601 [Wheelie] Scaffold the game package and manifest
- #1602 [Wheelie] Implement the state model and rules module
- #1603 [Wheelie] Wire up controls for both seats
- #1604 [Wheelie] Implement the core simulation
- #1605 [Wheelie] Implement scoring and the win condition
- #1606 [Wheelie] Implement rendering
- #1607 [Wheelie] Implement the split-seat layout and per-seat HUD placement
- #1608 [Wheelie] Integrate the shared match flow
- #1609 [Wheelie] Implement the bot opponent with three difficulty tiers
- #1610 [Wheelie] Create original art and wire the audio events
- #1611 [Wheelie] Write unit and deterministic simulation tests
- #1612 [Wheelie] QA pass against the definition of done

### wrestle (15)

- #1403 [Wrestle] Build the game
- #1404 [Wrestle] Research: play the reference genre and document observed mechanics
- #1405 [Wrestle] Write the game spec
- #1406 [Wrestle] Scaffold the game package and manifest
- #1407 [Wrestle] Implement the state model and rules module
- #1408 [Wrestle] Wire up controls for both seats
- #1409 [Wrestle] Implement the core simulation
- #1410 [Wrestle] Implement scoring and the win condition
- #1411 [Wrestle] Implement rendering
- #1412 [Wrestle] Implement the split-seat layout and per-seat HUD placement
- #1413 [Wrestle] Integrate the shared match flow
- #1414 [Wrestle] Implement the bot opponent with three difficulty tiers
- #1415 [Wrestle] Create original art and wire the audio events
- #1416 [Wrestle] Write unit and deterministic simulation tests
- #1417 [Wrestle] QA pass against the definition of done

### yazy (15)

- #458 [Dice Yatzy] Build the game
- #459 [Dice Yatzy] Research: play the reference genre and document observed mechanics
- #460 [Dice Yatzy] Write the game spec
- #461 [Dice Yatzy] Scaffold the game package and manifest
- #462 [Dice Yatzy] Implement the state model and rules module
- #463 [Dice Yatzy] Wire up controls for both seats
- #464 [Dice Yatzy] Implement the core simulation
- #465 [Dice Yatzy] Implement scoring and the win condition
- #466 [Dice Yatzy] Implement rendering
- #467 [Dice Yatzy] Integrate seat rotation and the turn indicator
- #468 [Dice Yatzy] Integrate the shared match flow
- #469 [Dice Yatzy] Implement the bot opponent with three difficulty tiers
- #470 [Dice Yatzy] Create original art and wire the audio events
- #471 [Dice Yatzy] Write unit and deterministic simulation tests
- #472 [Dice Yatzy] QA pass against the definition of done
