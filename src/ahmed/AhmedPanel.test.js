/* @vitest-environment happy-dom */
import fs from 'node:fs';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import AhmedPanel from './AhmedPanel.vue';
import AhmedPanelSource from './AhmedPanel.vue?raw';

const AhmedPanelCssSource = fs.readFileSync('src/ahmed/ahmed-panel.css', 'utf8');

describe('AhmedPanel', () => {
  it('owns its embedded layout stylesheet', () => {
    expect(AhmedPanelSource).toMatch(/<style\b[^>]*src=["']\.\/ahmed-panel\.css["'][^>]*><\/style>/);
  });

  it('defines light-theme fallback tokens for embedded placeholders and panel surfaces', () => {
    expect(AhmedPanelCssSource).toContain(':root[data-theme="light"] .ahmed-panel-root');
    expect(AhmedPanelCssSource).toContain('--ahmed-placeholder');
    expect(AhmedPanelCssSource).toContain('--ahmed-panel-soft');
    expect(AhmedPanelCssSource).toContain('--ahmed-panel-tint');
  });

  it('uses container-width responsive rules so embedded tools do not clip the right panel', () => {
    expect(AhmedPanelCssSource).toContain('container-type: inline-size;');
    expect(AhmedPanelCssSource).toMatch(/@container\s*\(max-width:\s*1496px\)\s*\{/);
    expect(AhmedPanelCssSource).toMatch(/@container[\s\S]*\.ahmed-panel-root \.tool\s*\{\s*grid-template-columns:\s*1fr;\s*\}/);
  });

  it('marks embedded mode on the page root', () => {
    const wrapper = mount(AhmedPanel, {
      props: {
        bootController: false,
        embedded: true,
      },
    });

    expect(wrapper.classes()).toContain('ahmed-panel-root');
    expect(wrapper.find('.page').classes()).toContain('page-embedded');
  });
});
