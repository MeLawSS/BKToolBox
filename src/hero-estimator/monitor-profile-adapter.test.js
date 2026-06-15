import { describe, expect, it } from 'vitest';
import { createMonitorProfileAdapter } from './monitor-profile-adapter.js';
import { elsaProfile } from './hero-profiles.js';

describe('monitor profile adapter', () => {
  it('accumulates Elsa payloads without collapsing white and green', () => {
    const adapter = createMonitorProfileAdapter(elsaProfile);
    let state = adapter.createState();

    state = adapter.applyPayload(state, {
      key: 'skill:white',
      gameUid: 'game-1',
      round: 1,
      group: 'hero',
      skill: {
        uid: 'skill:white',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [{ boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' }],
      },
    });

    state = adapter.applyPayload(state, {
      key: 'skill:green',
      gameUid: 'game-1',
      round: 2,
      group: 'hero',
      skill: {
        uid: 'skill:green',
        heroCid: 103,
        skillCid: 1001033,
        hitBoxList: [{ boxId: 10, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' }],
      },
    });

    expect(adapter.getAutoFills(state)).toContainEqual({ groupKey: 'white', fieldKey: 'cells', value: '1' });
    expect(adapter.getAutoFills(state)).toContainEqual({ groupKey: 'green', fieldKey: 'cells', value: '1' });
  });
});
