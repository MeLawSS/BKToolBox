import monitorProfilesModule from '../../lib/bidking-hero-profiles.js';

const {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
  resolveQualityGroupFromId,
  resolveQualityGroupFromName,
} = monitorProfilesModule;
const ETHAN_EXCLUSIVE_HERO_SKILL_CIDS = new Set([1002081, 1002082, 1002083, 1002084]);

export const ethanProfile = {
  id: 'ethan',
  storageKey: 'bidking-page-state:v1:ethan',
  mark: 'E',
  titleKey: 'ethan.title',
  subtitleKey: 'ethan.subtitle',
  toolLabelKey: 'ethan.toolLabel',
  inputSubtitleKey: 'ethan.inputSubtitle',
  globalSectionTitleKey: 'ahmed.sections.global',
  messageNs: 'ethan',
  monitorIds: {
    switch: 'ethan-monitor-switch',
    types: 'ethan-monitor-types',
    minimum: 'ethan-monitor-minimum',
    board: 'ethan-monitor-board',
  },
  supportsMonitor: true,
  monitorProfile: ETHAN_MONITOR_PROFILE,
  groups: [
    { key: 'wg', label: '白+绿', qualities: ['白', '绿'], labelKey: 'ethan.groups.wg', qualitiesKey: 'ethan.groups.wgQualities' },
    { key: 'blue', label: '蓝色', qualities: ['蓝'], labelKey: 'ethan.groups.blue', qualitiesKey: 'ethan.groups.blueQualities' },
    { key: 'purple', label: '紫色', qualities: ['紫'], labelKey: 'ethan.groups.purple', qualitiesKey: 'ethan.groups.purpleQualities' },
    { key: 'orange', label: '橙/金色', qualities: ['金'], labelKey: 'ethan.groups.orange', qualitiesKey: 'ethan.groups.orangeQualities' },
    { key: 'red', label: '红色', qualities: ['红'], labelKey: 'ethan.groups.red', qualitiesKey: 'ethan.groups.redQualities' },
  ],
  perCellExpected: { wg: 232, blue: 889, purple: 2482, orange: 9228, red: 40000 },
  overflowRelaxationGroupKeys: ['wg', 'blue'],
  overflowRelaxationBuffer: 20,
  streamSearchConfigs: [
    { groupKey: 'purple', labelKey: 'ethan.groups.purple', script: 'solve-purple-combo.js' },
    { groupKey: 'orange', labelKey: 'ethan.groups.orange', script: 'solve-gold-combo.js' },
  ],
  totalPriceGroupKeys: [],
};

export const elsaProfile = {
  id: 'elsa',
  storageKey: 'bidking-page-state:v1:elsa-hero',
  mark: 'L',
  titleKey: 'tools.hero.elsaTitle',
  subtitleKey: 'tools.hero.elsaSubtitle',
  toolLabelKey: 'tools.hero.elsaToolLabel',
  inputSubtitleKey: 'tools.hero.elsaInputSubtitle',
  globalSectionTitleKey: 'ahmed.sections.global',
  messageNs: 'tools.hero',
  monitorIds: {
    switch: 'elsa-monitor-switch',
    types: 'elsa-monitor-types',
    minimum: 'elsa-monitor-minimum',
    board: 'elsa-monitor-board',
  },
  supportsMonitor: true,
  monitorProfile: ELSA_MONITOR_PROFILE,
  groups: [
    { key: 'white', label: '白色', qualities: ['白'], labelKey: 'ethan.groups.white', qualitiesKey: 'ethan.groups.whiteQualities' },
    { key: 'green', label: '绿色', qualities: ['绿'], labelKey: 'ethan.groups.green', qualitiesKey: 'ethan.groups.greenQualities' },
    { key: 'blue', label: '蓝色', qualities: ['蓝'], labelKey: 'ethan.groups.blue', qualitiesKey: 'ethan.groups.blueQualities' },
    { key: 'purple', label: '紫色', qualities: ['紫'], labelKey: 'ethan.groups.purple', qualitiesKey: 'ethan.groups.purpleQualities' },
    { key: 'orange', label: '橙/金色', qualities: ['金'], labelKey: 'ethan.groups.orange', qualitiesKey: 'ethan.groups.orangeQualities' },
    { key: 'red', label: '红色', qualities: ['红'], labelKey: 'ethan.groups.red', qualitiesKey: 'ethan.groups.redQualities' },
  ],
  perCellExpected: { white: 124, green: 328, blue: 889, purple: 2482, orange: 9228, red: 40000 },
  overflowRelaxationGroupKeys: [],
  overflowRelaxationBuffer: 0,
  streamSearchConfigs: [
    { groupKey: 'orange', labelKey: 'ethan.groups.orange', script: 'solve-gold-combo.js' },
  ],
  totalPriceGroupKeys: ['orange'],
};

export function resolveGroupKeyFromQuality(profile, qualityName, qualityId = undefined) {
  return resolveQualityGroupFromId(profile.monitorProfile, qualityId)
    || resolveQualityGroupFromName(profile.monitorProfile, qualityName);
}

export function inferProfileIdFromRawMonitorEvent(rawPayload) {
  const rawEvent = rawPayload?.rawEvent ?? rawPayload;
  const skill = rawEvent?.skill;
  const skillCid = Number(skill?.skillCid);
  const heroCid = Number(skill?.heroCid);

  if (
    rawEvent?.group === 'hero'
    && heroCid === 103
    && ELSA_MONITOR_PROFILE.completeRevealHeroSkillCids.includes(skillCid)
  ) {
    return 'elsa';
  }

  if (ETHAN_EXCLUSIVE_HERO_SKILL_CIDS.has(skillCid)) {
    return 'ethan';
  }

  return null;
}
