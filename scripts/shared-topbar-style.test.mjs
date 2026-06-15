import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const topBarPath = path.resolve('src', 'shared', 'TopBar.vue');
const injectCssPath = path.resolve('src', 'inject', 'inject.css');

describe('shared TopBar style ownership', () => {
  it('loads a shared topbar base stylesheet from the TopBar component', () => {
    const source = readFileSync(topBarPath, 'utf8');
    expect(source).toContain("import './topbar-base.css';");
  });

  it('does not let inject.css redefine shared topbar theme and language selectors', () => {
    const source = readFileSync(injectCssPath, 'utf8');
    const forbiddenSelectorPatterns = [
      /^\s*\.topbar\b/m,
      /^\s*\.brand\b/m,
      /^\s*\.nav\b/m,
      /^\s*\.lang-capsule\b/m,
      /^\s*\.lang-capsule-opt\b/m,
      /^\s*\.theme-toggle\b/m,
      /^\s*\.theme-toggle-track\b/m,
      /^\s*\.theme-toggle-thumb\b/m,
      /^\s*\.theme-toggle-icon\b/m,
    ];

    for (const pattern of forbiddenSelectorPatterns) {
      expect(pattern.test(source)).toBe(false);
    }
  });
});
