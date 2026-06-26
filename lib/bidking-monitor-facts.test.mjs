import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildBidKingMonitorFacts,
  getQualityGroupFromId,
  getQualityGroupFromName,
} = require('./bidking-monitor-facts.js');
const {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
} = require('./bidking-hero-profiles.js');

describe('buildBidKingMonitorFacts', () => {
  it('converts outline, type, and quality payloads into domain facts', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:outline',
      gameUid: 'game-1',
      round: 2,
      skill: {
        uid: 'outline-skill',
        skillCid: 1002081,
        hitItemTypeNames: ['家居日用', '数码电子'],
        hitBoxList: [
          { boxId: 25, itemSlotType: 22, itemQuility: 3, itemQuilityName: '蓝' },
        ],
      },
    });

    expect(facts).toEqual([
      expect.objectContaining({ type: 'game.changed', gameUid: 'game-1', round: 2 }),
      expect.objectContaining({ type: 'type.revealed', gameUid: 'game-1', itemTypes: ['家居日用', '数码电子'] }),
      expect.objectContaining({
        type: 'item.qualityCellsRevealed',
        gameUid: 'game-1',
        cells: [26],
        quality: { id: 3, name: '蓝', group: 'blue' },
      }),
      expect.objectContaining({
        type: 'item.outlineRevealed',
        gameUid: 'game-1',
        cells: [26, 27, 36, 37],
        width: 2,
        height: 2,
        quality: { id: 3, name: '蓝', group: 'blue' },
      }),
    ]);
  });

  it('converts exact item payloads into exact item facts', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:exact',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 0,
          itemCid: 1033001,
          itemName: '测试藏品',
          itemSlotType: 11,
          itemQuility: 4,
          itemQuilityName: '紫',
          itemPrice: 12345,
        }],
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'item.exactRevealed',
      itemCid: 1033001,
      itemName: '测试藏品',
      itemPrice: 12345,
      cells: [1],
      quality: { id: 4, name: '紫', group: 'purple' },
    }));
  });

  it('fills quality display names from ids when the payload omits itemQuilityName', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:elsa-id-only-quality',
      gameUid: 'game-1',
      group: 'hero',
      skill: {
        uid: 'elsa-id-only-quality',
        heroCid: 103,
        skillCid: 1001033,
        hitBoxList: [
          { boxId: 10, itemSlotType: 11, itemQuility: 2 },
        ],
      },
    }, ELSA_MONITOR_PROFILE);

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'item.qualityCellsRevealed',
      quality: { id: 2, name: '绿', group: 'green' },
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      type: 'item.outlineRevealed',
      quality: { id: 2, name: '绿', group: 'green' },
    }));
  });

  it('preserves exact item metadata on shaped outline facts', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:exact-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-outline-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 25,
          itemCid: '1033001',
          itemName: '测试藏品',
          itemSlotType: 22,
          itemQuility: 3,
          itemQuilityName: '蓝',
          price: '3851',
        }],
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'item.outlineRevealed',
      itemCid: 1033001,
      itemName: '测试藏品',
      itemPrice: 3851,
      cells: [26, 27, 36, 37],
      width: 2,
      height: 2,
      quality: { id: 3, name: '蓝', group: 'blue' },
    }));
  });

  it('does not emit item facts with cells outside the monitor board', () => {
    const invalidOutlineFacts = buildBidKingMonitorFacts({
      key: 'skill:invalid-outline',
      gameUid: 'game-1',
      skill: {
        uid: 'invalid-outline',
        hitBoxList: [{
          boxId: 420,
          itemCid: 1033001,
          itemName: '越界藏品',
          itemSlotType: 22,
          itemQuility: 4,
          itemQuilityName: '紫',
        }],
      },
    });

    expect(invalidOutlineFacts).not.toContainEqual(expect.objectContaining({
      type: 'item.outlineRevealed',
    }));
    expect(invalidOutlineFacts).not.toContainEqual(expect.objectContaining({
      type: 'item.exactRevealed',
    }));
    expect(invalidOutlineFacts.flatMap((fact) => fact.cells ?? []).every((cell) => cell >= 1 && cell <= 430)).toBe(true);

    const invalidQualityFacts = buildBidKingMonitorFacts({
      key: 'skill:invalid-quality',
      gameUid: 'game-1',
      skill: {
        uid: 'invalid-quality',
        hitBoxList: [{ boxId: 430, itemQuility: 3, itemQuilityName: '蓝' }],
      },
    });

    expect(invalidQualityFacts).not.toContainEqual(expect.objectContaining({
      type: 'item.qualityCellsRevealed',
    }));
  });

  it.each([
    [200010, 'group.totalCellsKnown', 'purple', 'totalHitBoxIndex', 12],
    [200011, 'group.totalCellsKnown', 'orange', 'totalHitBoxIndex', 21],
    [200012, 'group.totalCellsKnown', 'red', 'totalHitBoxIndex', 6],
    [200013, 'group.averageCellsKnown', 'purple', 'allHitItemAvgBoxIndex', 2.5],
    [200015, 'group.averageCellsKnown', 'orange', 'allHitItemAvgBoxIndex', 3.2],
    [200016, 'group.averageCellsKnown', 'red', 'allHitItemAvgBoxIndex', 4.5],
    [200036, 'group.averagePriceKnown', 'purple', 'allHitItemAvgPrice', 10806],
    [200037, 'group.averagePriceKnown', 'orange', 'allHitItemAvgPrice', 30472],
    [200038, 'group.averagePriceKnown', 'red', 'allHitItemAvgPrice', 77700.25],
  ])('converts known map aggregate skill %s into a group fact', (skillCid, type, group, valueKey, value) => {
    expect(buildBidKingMonitorFacts({
      key: `skill:${skillCid}`,
      gameUid: 'game-1',
      skill: { uid: `aggregate-${skillCid}`, skillCid, [valueKey]: value },
    })).toContainEqual(expect.objectContaining({
      type,
      group,
      value,
    }));
  });

  it('does not treat map aggregate skill 200014 as a quality-specific average', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:200014',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'aggregate-200014',
        skillCid: 200014,
        allHitItemAvgBoxIndex: 1.75,
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
    }));
  });

  it('uses item cid before generic skill cid for known map aggregate facts', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:item-cid-priority',
      gameUid: 'game-1',
      skill: {
        uid: 'item-cid-priority',
        itemCid: 200037,
        skillCid: 200010,
        totalHitBoxIndex: 12,
        allHitItemAvgPrice: 30472,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averagePriceKnown',
      group: 'orange',
      value: 30472,
    }));
  });

  it('falls through to the next known aggregate source ID when the first value is missing', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:known-fallback',
      gameUid: 'game-1',
      skill: {
        uid: 'known-fallback',
        itemCid: 200037,
        skillCid: 200010,
        totalHitBoxIndex: 12,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 12,
    }));
  });

  it('omits aggregate facts with malformed numeric values', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:bad-aggregate-value',
      gameUid: 'game-1',
      skill: {
        uid: 'bad-aggregate-value',
        skillCid: 200010,
        totalHitBoxIndex: 'abc',
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
    }));
  });

  it('converts single-quality total cells without a known scan id or name', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:quality-only-orange-zero',
      gameUid: '2101:1274128138819884',
      group: 'map',
      skill: {
        uid: 'quality-only-orange-zero',
        totalHitBoxIndex: 0,
        hitItemQuilityList: [5],
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('converts purple zero-count aggregate packets into zero total cells when totalHitBoxIndex is missing', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-zero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-zero-count',
        skillCid: 203,
        hitItemIndex: 0,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));
  });

  it('does not infer purple zero total cells when hitItemIndex is non-zero', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-nonzero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-nonzero-count',
        skillCid: 203,
        hitItemIndex: 2,
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
    }));
  });

  it('does not infer purple zero total cells for Elsa from the same skillCid 203 zero-count packet', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:elsa-purple-zero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'elsa-purple-zero-count',
        skillCid: 203,
        hitItemIndex: 0,
      },
    }, ELSA_MONITOR_PROFILE)).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
    }));
  });

  it('does not infer purple zero total cells for a name-only purple aggregate packet', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-name-only-zero-count',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-name-only-zero-count',
        itemName: '优品扫描',
        hitItemIndex: 0,
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));
  });

  it('does not emit purple average cells from a scan aggregate id when only the opposite aggregate value is present', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-scan-id-average-only',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-scan-id-average-only',
        skillCid: 203,
        allHitItemAvgBoxIndex: 2.8,
      },
    })).not.toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'purple',
      value: 2.8,
    }));
  });

  it('converts named scan and average-cell skills into group facts', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:blue-scan',
      gameUid: 'game-1',
      skill: { uid: 'blue-scan', itemName: '良品扫描', totalHitBoxIndex: 29 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'blue',
      value: 29,
    }));

    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-avg',
      gameUid: 'game-1',
      skill: { uid: 'purple-avg', itemName: '优品均格', allHitItemAvgBoxIndex: 2.8 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'purple',
      value: 2.8,
    }));
  });

  it('routes Elsa 优品 aggregate skills to the purple group', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:elsa-purple-avg',
      gameUid: 'game-1',
      skill: { uid: 'elsa-purple-avg', itemName: '优品均格', allHitItemAvgBoxIndex: 2.8 },
    }, ELSA_MONITOR_PROFILE)).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'purple',
      value: 2.8,
    }));

    expect(buildBidKingMonitorFacts({
      key: 'skill:elsa-purple-scan-id',
      gameUid: 'game-1',
      skill: { uid: 'elsa-purple-scan-id', skillCid: 203, totalHitBoxIndex: 17 },
    }, ELSA_MONITOR_PROFILE)).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 17,
    }));
  });

  it.each([
    [201, 'skillCid', 'wg'],
    [202, 'skillCid', 'blue'],
    [203, 'skillCid', 'purple'],
    [204, 'skillCid', 'orange'],
    [205, 'skillCid', 'red'],
    [100104, 'itemCid', 'wg'],
    [100105, 'itemCid', 'blue'],
    [100106, 'itemCid', 'purple'],
    [100107, 'itemCid', 'orange'],
    [100108, 'itemCid', 'red'],
  ])('converts scan aggregate ID %s into a total-cells group fact', (sourceId, sourceKey, group) => {
    expect(buildBidKingMonitorFacts({
      key: `skill:scan-${sourceId}`,
      gameUid: 'game-1',
      skill: { uid: `scan-${sourceId}`, [sourceKey]: sourceId, totalHitBoxIndex: 29 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group,
      value: 29,
    }));
  });

  it.each([
    [301, 'skillCid', 'wg'],
    [302, 'skillCid', 'blue'],
    [303, 'skillCid', 'purple'],
    [304, 'skillCid', 'orange'],
    [305, 'skillCid', 'red'],
    [100110, 'itemCid', 'wg'],
    [100111, 'itemCid', 'blue'],
    [100112, 'itemCid', 'purple'],
    [100113, 'itemCid', 'orange'],
    [100114, 'itemCid', 'red'],
  ])('converts average-cell aggregate ID %s into an average-cells group fact', (sourceId, sourceKey, group) => {
    expect(buildBidKingMonitorFacts({
      key: `skill:average-${sourceId}`,
      gameUid: 'game-1',
      skill: { uid: `average-${sourceId}`, [sourceKey]: sourceId, allHitItemAvgBoxIndex: 2.8 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group,
      value: 2.8,
    }));
  });

  it('uses item cid before generic skill cid for ID-based aggregate facts', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:id-priority',
      gameUid: 'game-1',
      skill: {
        uid: 'id-priority',
        itemCid: 100105,
        skillCid: 201,
        totalHitBoxIndex: 44,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'blue',
      value: 44,
    }));
  });

  it('uses higher-priority item cid when it selects average cells and skill cid selects total cells', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:id-cross-type-priority',
      gameUid: 'game-1',
      skill: {
        uid: 'id-cross-type-priority',
        itemCid: 100110,
        skillCid: 201,
        allHitItemAvgBoxIndex: 2.5,
      },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'wg',
      value: 2.5,
    }));
  });

  it('keeps higher-priority item cid aggregate type when lower-priority skill cid also has a value', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:id-cross-type-priority-with-both-values',
      gameUid: 'game-1',
      skill: {
        uid: 'id-cross-type-priority-with-both-values',
        itemCid: 100110,
        skillCid: 201,
        allHitItemAvgBoxIndex: 2.5,
        totalHitBoxIndex: 10,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'wg',
      value: 2.5,
    }));
    expect(facts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'wg',
      value: 10,
    }));
  });

  it('keeps higher-priority generic item cid before lower-priority known-map skill cid', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:generic-before-known-priority',
      gameUid: 'game-1',
      skill: {
        uid: 'generic-before-known-priority',
        itemCid: 100110,
        skillCid: 200010,
        allHitItemAvgBoxIndex: 2.5,
        totalHitBoxIndex: 12,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'wg',
      value: 2.5,
    }));
    expect(facts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 12,
    }));
  });

  it('maps quality names to stable quality groups', () => {
    expect(getQualityGroupFromName('白')).toBe('wg');
    expect(getQualityGroupFromName('绿')).toBe('wg');
    expect(getQualityGroupFromName('普')).toBe('wg');
    expect(getQualityGroupFromName('蓝')).toBe('blue');
    expect(getQualityGroupFromName('良')).toBe('blue');
    expect(getQualityGroupFromName('紫')).toBe('purple');
    expect(getQualityGroupFromName('优')).toBe('purple');
    expect(getQualityGroupFromName('金')).toBe('orange');
    expect(getQualityGroupFromName('橙')).toBe('orange');
    expect(getQualityGroupFromName('极')).toBe('orange');
    expect(getQualityGroupFromName('红')).toBe('red');
    expect(getQualityGroupFromName('珍')).toBe('red');

    expect(getQualityGroupFromId(1)).toBe('wg');
    expect(getQualityGroupFromId(2)).toBe('wg');
    expect(getQualityGroupFromId(3)).toBe('blue');
    expect(getQualityGroupFromId(4)).toBe('purple');
    expect(getQualityGroupFromId(5)).toBe('orange');
    expect(getQualityGroupFromId(6)).toBe('red');
  });

  it('keeps Ethan wg merging but splits white and green for Elsa', () => {
    const rawEvent = {
      key: 'skill:split-qualities',
      gameUid: 'game-1',
      skill: {
        uid: 'split-qualities',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 0, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
          { boxId: 1, itemSlotType: 11, itemQuility: 2, itemQuilityName: '绿' },
        ],
      },
    };

    const ethanFacts = buildBidKingMonitorFacts(rawEvent, ETHAN_MONITOR_PROFILE);
    const elsaFacts = buildBidKingMonitorFacts(rawEvent, ELSA_MONITOR_PROFILE);

    expect(
      ethanFacts
        .filter((fact) => fact.type === 'item.qualityCellsRevealed')
        .map((fact) => fact.quality.group)
    ).toEqual(['wg', 'wg']);

    expect(
      elsaFacts
        .filter((fact) => fact.type === 'item.qualityCellsRevealed')
        .map((fact) => fact.quality.group)
    ).toEqual(['white', 'green']);
  });

  it('emits a complete-reveal fact for Elsa primary hero packets', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:elsa-white',
      gameUid: 'game-1',
      round: 1,
      group: 'hero',
      skill: {
        uid: 'elsa-white',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [
          { boxId: 24, itemSlotType: 11, itemQuility: 1, itemQuilityName: '白' },
        ],
      },
    }, ELSA_MONITOR_PROFILE);

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.completeReveal',
      group: 'white',
      gameUid: 'game-1',
    }));
  });

  it('emits Elsa white complete-reveal even when the packet reveals zero white outlines', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:elsa-white-empty',
      gameUid: 'game-1',
      round: 1,
      group: 'hero',
      skill: {
        uid: 'elsa-white-empty',
        heroCid: 103,
        skillCid: 1001034,
        hitBoxList: [],
      },
    }, ELSA_MONITOR_PROFILE);

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.completeReveal',
      group: 'white',
      gameUid: 'game-1',
    }));
  });

  it('emits orange totalCells=0 when orange averageCells aggregate value is zero', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-zero-average',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 0,
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('emits orange totalCells=0 from orange zero average under the Elsa profile too', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-zero-average-elsa',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-zero-average-elsa',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 0,
      },
    }, ELSA_MONITOR_PROFILE);

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 0,
    }));
    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('does not infer orange totalCells=0 when orange averageCells value is non-zero', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:orange-nonzero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'orange-nonzero-average',
        skillCid: 200015,
        allHitItemAvgBoxIndex: 3.2,
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'orange',
      value: 3.2,
    }));
    expect(facts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'orange',
      value: 0,
    }));
  });

  it('does not infer totalCells=0 for purple or red when their average is zero', () => {
    const purpleFacts = buildBidKingMonitorFacts({
      key: 'skill:purple-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'purple-zero-average',
        skillCid: 200013,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(purpleFacts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 0,
    }));

    const redFacts = buildBidKingMonitorFacts({
      key: 'skill:red-zero-average',
      gameUid: 'game-1',
      group: 'map',
      skill: {
        uid: 'red-zero-average',
        skillCid: 200016,
        allHitItemAvgBoxIndex: 0,
      },
    });

    expect(redFacts).not.toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'red',
      value: 0,
    }));
  });
});
