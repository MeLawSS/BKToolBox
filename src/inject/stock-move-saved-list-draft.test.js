import { describe, expect, it } from 'vitest';
import {
  addDraftCollectible,
  buildSavedListSnapshotItems,
  filterCollectiblesForDraftSearch,
} from './stock-move-saved-list-draft.js';

const collectibles = [
  {
    itemCid: 1011001,
    name: 'Data Cable',
    quality: 'white',
    type: 'daily',
    size: { key: '1x1' },
  },
  {
    itemCid: 1083009,
    name: 'Intake Manifold',
    quality: 'blue',
    type: 'vehicle',
    size: { key: '1x2' },
  },
];

describe('stock-move-saved-list-draft helpers', () => {
  it('deduplicates draft itemCids when adding the same collectible twice', () => {
    const first = addDraftCollectible([], collectibles[1]);
    const second = addDraftCollectible(first, collectibles[1]);

    expect(second.map((item) => item.itemCid)).toEqual([1083009]);
  });

  it('deduplicates draft itemCids across mixed string and number values', () => {
    const first = addDraftCollectible([], { ...collectibles[1], itemCid: '1083009' });
    const second = addDraftCollectible(first, collectibles[1]);

    expect(second).toHaveLength(1);
    expect(second[0].itemCid).toBe('1083009');
  });

  it('falls back to cid when itemCid is present but invalid', () => {
    const collectible = {
      ...collectibles[1],
      itemCid: 'abc',
      cid: 1083009,
    };

    expect(addDraftCollectible([], collectible)).toEqual([collectible]);
    expect(filterCollectiblesForDraftSearch([collectible], '1083009')).toEqual([collectible]);
    expect(buildSavedListSnapshotItems([collectible])).toEqual([
      {
        itemCid: 1083009,
        name: 'Intake Manifold',
        quality: 'blue',
        type: 'vehicle',
        sizeKey: '1x2',
      },
    ]);
  });

  it('rejects permissive Number coercions and falls back to cid', () => {
    const cases = [
      { itemCid: true, cid: 2083009 },
      { itemCid: [1083009], cid: 3083009 },
      { itemCid: '0x10', cid: 4083009 },
    ];

    for (const { itemCid, cid } of cases) {
      const collectible = {
        ...collectibles[1],
        itemCid,
        cid,
      };

      expect(addDraftCollectible([{ itemCid: cid }], collectible)).toEqual([{ itemCid: cid }]);
      expect(filterCollectiblesForDraftSearch([collectible], String(cid))).toEqual([collectible]);
      expect(buildSavedListSnapshotItems([collectible])).toEqual([
        {
          itemCid: cid,
          name: 'Intake Manifold',
          quality: 'blue',
          type: 'vehicle',
          sizeKey: '1x2',
        },
      ]);
    }
  });

  it('filters full collectibles by name, itemCid, quality, and type', () => {
    expect(filterCollectiblesForDraftSearch(collectibles, 'intake').map((item) => item.itemCid)).toEqual([1083009]);
    expect(filterCollectiblesForDraftSearch(collectibles, '1011001').map((item) => item.itemCid)).toEqual([1011001]);
    expect(filterCollectiblesForDraftSearch(collectibles, 'vehicle').map((item) => item.itemCid)).toEqual([1083009]);
  });

  it('builds saved-list snapshot items with the required shape', () => {
    expect(buildSavedListSnapshotItems([collectibles[1]])).toEqual([
      {
        itemCid: 1083009,
        name: 'Intake Manifold',
        quality: 'blue',
        type: 'vehicle',
        sizeKey: '1x2',
      },
    ]);
  });

  it('drops malformed draft entries with no valid snapshot id', () => {
    expect(
      buildSavedListSnapshotItems([
        collectibles[1],
        {
          itemCid: '',
          cid: 'abc',
          name: 'Broken Item',
          quality: 'red',
          type: 'broken',
          size: { key: '9x9' },
        },
      ]),
    ).toEqual([
      {
        itemCid: 1083009,
        name: 'Intake Manifold',
        quality: 'blue',
        type: 'vehicle',
        sizeKey: '1x2',
      },
    ]);
  });
});
