import { describe, expect, it } from 'vitest';
import controllerUiNodeLabels from '../../public/data/controller-ui-node-labels.json';

describe('controller UI node labels', () => {
  it('contains the configured label for the main trade button', () => {
    expect(controllerUiNodeLabels['MainPanel/mask/Button']).toBe('竞拍');
  });
});
