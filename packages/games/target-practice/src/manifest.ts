import { parseGameManifest } from '@duelbox/game-sdk';

export const manifest = parseGameManifest({
  id: 'target-practice',
  name: 'Target Practice',
  category: 'Shooter',
  archetype: 'turn-aim',
  modes: ['friend', 'bot'],
  presentations: ['shared-screen', 'single-seat'],
  logical: { width: 700, height: 1000 },
  orientation: 'portrait',
  zoneSplit: 'shared-board',
  roundSeconds: 90,
  // Two presses and nothing else, so a key, a trackpad and a thumb are the same instrument.
  // The first keeps a distance off a moving gauge; the second is a moment, because the shot
  // has to be in the air before the target arrives.
  controls: {
    keyboard:
      'Player one presses Space, player two Enter: once to keep the distance, again to shoot',
    pointer: 'Tap anywhere on your turn: once to keep the distance, again to shoot',
  },
  tags: ['aim', 'timing'],
});
