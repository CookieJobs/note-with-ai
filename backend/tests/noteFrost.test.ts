import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FROST_MAX_LAYERS,
  currentFrostLayers,
  frostTargetLayers,
  meltOneFrostLayer,
} from '../services/noteFrost';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);
const age = (days: number) => new Date(NOW - days * DAY);

describe('note time frost', () => {
  it('maps age to progressive layers and caps at five', () => {
    assert.equal(frostTargetLayers(0), 0);
    assert.equal(frostTargetLayers(1 * DAY), 0);
    assert.equal(frostTargetLayers(2 * DAY), 1);
    assert.equal(frostTargetLayers(7 * DAY), 2);
    assert.equal(frostTargetLayers(21 * DAY), 3);
    assert.equal(frostTargetLayers(60 * DAY), 4);
    assert.equal(frostTargetLayers(180 * DAY), 5);
    assert.equal(frostTargetLayers(5000 * DAY), FROST_MAX_LAYERS);
  });

  it('keeps fresh and undated notes readable', () => {
    assert.equal(currentFrostLayers({ createdAt: age(0) }, NOW), 0);
    assert.equal(currentFrostLayers({ createdAt: '' }, NOW), 0);
    assert.equal(currentFrostLayers({ createdAt: null }, NOW), 0);
  });

  it('subtracts melted layers from the time-derived thickness', () => {
    assert.equal(currentFrostLayers({ createdAt: age(180), melted: 2 }, NOW), 3);
    assert.equal(currentFrostLayers({ createdAt: age(180), melted: 5 }, NOW), 0);
    assert.equal(currentFrostLayers({ createdAt: age(180), melted: 9 }, NOW), 0);
  });

  it('uses the last full thaw as the new cycle anchor', () => {
    const thawedAt = age(7);
    assert.equal(currentFrostLayers({ createdAt: age(400), thawedAt: age(6) }, NOW), 0);
    assert.equal(currentFrostLayers({ createdAt: age(400), thawedAt: age(14) }, NOW), 2);
    assert.equal(currentFrostLayers({ createdAt: age(400), thawedAt }, NOW), 1);
    assert.equal(currentFrostLayers({ createdAt: age(400), thawedAt, melted: 1 }, NOW), 0);
  });

  it('melts one layer at a time without resetting the anchor early', () => {
    const input = { createdAt: age(180), thawedAt: null, melted: 0 };
    const first = meltOneFrostLayer(input, NOW);
    assert.equal(first.layers, 4);
    assert.equal(first.melted, 1);
    assert.equal(first.thawedAt, null);
    assert.equal(first.changed, true);

    const second = meltOneFrostLayer({ ...input, melted: first.melted }, NOW);
    assert.equal(second.layers, 3);
    assert.equal(second.melted, 2);
  });

  it('resets the cycle when the last layer is wiped', () => {
    const result = meltOneFrostLayer({ createdAt: age(180), melted: 4 }, NOW);
    assert.equal(result.layers, 0);
    assert.equal(result.melted, 0);
    assert.equal(result.changed, true);
    assert.ok(result.thawedAt instanceof Date);
    assert.equal(result.thawedAt?.getTime(), NOW);
    // A fresh cycle starts clear even though the note itself is old.
    assert.equal(currentFrostLayers({ createdAt: age(180), thawedAt: result.thawedAt, melted: 0 }, NOW), 0);
  });

  it('is a no-op on an already clear card', () => {
    const result = meltOneFrostLayer({ createdAt: age(0) }, NOW);
    assert.equal(result.changed, false);
    assert.equal(result.layers, 0);
  });
});