import { describe, expect, it } from 'vitest';
// The generator is the source of truth; this test re-runs it and asserts the committed data
// matches, so a dependency bump (or a font licence change) that was not re-emitted fails CI.
// Same pattern as research-provenance.test.ts: a committed artefact guarded against going stale.
import { buildAttribution } from '../../../../../scripts/emit-attribution.mjs';
import { RUNTIME_DEPENDENCIES, FONT_ATTRIBUTIONS } from './attribution-data.generated';

describe('attribution data is generated, not hand-maintained (#215)', () => {
  const fresh = buildAttribution();

  it('the runtime dependency list matches the shipped dependencies', () => {
    expect(RUNTIME_DEPENDENCIES).toEqual(fresh.runtime);
  });

  it('the font attribution list matches the asset licence record', () => {
    expect(FONT_ATTRIBUTIONS).toEqual(fresh.fonts);
  });

  it('every runtime dependency names a resolved version and a licence', () => {
    expect(RUNTIME_DEPENDENCIES.length).toBeGreaterThan(0);
    for (const dep of RUNTIME_DEPENDENCIES) {
      expect(dep.version).not.toBe('0.0.0');
      expect(dep.licence).not.toBe('UNKNOWN');
    }
  });

  it('no first-party @duelbox package leaks into the third-party list', () => {
    for (const dep of RUNTIME_DEPENDENCIES) {
      expect(dep.name.startsWith('@duelbox/')).toBe(false);
    }
  });
});
