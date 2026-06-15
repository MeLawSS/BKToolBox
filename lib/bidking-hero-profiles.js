const ETHAN_MONITOR_PROFILE = {
  id: 'ethan',
  groupKeys: ['wg', 'blue', 'purple', 'orange', 'red'],
  qualityIdGroups: {
    1: 'wg',
    2: 'wg',
    3: 'blue',
    4: 'purple',
    5: 'orange',
    6: 'red',
  },
  aggregateIdGroups: {
    201: 'wg',
    202: 'blue',
    203: 'purple',
    204: 'orange',
    205: 'red',
    301: 'wg',
    302: 'blue',
    303: 'purple',
    304: 'orange',
    305: 'red',
    100104: 'wg',
    100105: 'blue',
    100106: 'purple',
    100107: 'orange',
    100108: 'red',
    100110: 'wg',
    100111: 'blue',
    100112: 'purple',
    100113: 'orange',
    100114: 'red',
  },
  aggregateNameMatchers: [
    [/普品/, 'wg'],
    [/良品/, 'blue'],
    [/优品/, 'purple'],
    [/极品/, 'orange'],
    [/珍品/, 'red'],
  ],
  qualityNameMatchers: [
    [/[白绿普]/, 'wg'],
    [/[蓝良]/, 'blue'],
    [/[紫优]/, 'purple'],
    [/[金橙极]/, 'orange'],
    [/[红珍]/, 'red'],
  ],
  completeRevealHeroSkillCids: [],
  completeRevealGroups: new Set(),
};

const ELSA_MONITOR_PROFILE = {
  id: 'elsa',
  groupKeys: ['white', 'green', 'blue', 'purple', 'orange', 'red'],
  qualityIdGroups: {
    1: 'white',
    2: 'green',
    3: 'blue',
    4: 'purple',
    5: 'orange',
    6: 'red',
  },
  aggregateIdGroups: {
    201: 'white',
    202: 'green',
    203: 'purple',
    204: 'orange',
    205: 'red',
    301: 'white',
    302: 'green',
    303: 'purple',
    304: 'orange',
    305: 'red',
    100104: 'white',
    100105: 'green',
    100106: 'purple',
    100107: 'orange',
    100108: 'red',
    100110: 'white',
    100111: 'green',
    100112: 'purple',
    100113: 'orange',
    100114: 'red',
  },
  aggregateNameMatchers: [
    [/普品/, 'white'],
    [/良品/, 'green'],
    [/优品/, 'purple'],
    [/极品/, 'orange'],
    [/珍品/, 'red'],
  ],
  qualityNameMatchers: [
    [/[白普]/, 'white'],
    [/[绿]/, 'green'],
    [/[蓝良]/, 'blue'],
    [/[紫优]/, 'purple'],
    [/[金橙极]/, 'orange'],
    [/[红珍]/, 'red'],
  ],
  completeRevealHeroSkillCids: [1001031, 1001032, 1001033, 1001034],
  completeRevealGroups: new Set(['white', 'green', 'blue', 'purple']),
};

function getBidKingHeroProfile(profileOrId = ETHAN_MONITOR_PROFILE) {
  if (profileOrId && typeof profileOrId === 'object' && Array.isArray(profileOrId.groupKeys)) {
    return profileOrId;
  }
  return String(profileOrId) === 'elsa' ? ELSA_MONITOR_PROFILE : ETHAN_MONITOR_PROFILE;
}

function resolveQualityGroupFromId(profile, id) {
  return getBidKingHeroProfile(profile).qualityIdGroups[Number(id)] || '';
}

function resolveQualityGroupFromName(profile, name) {
  const normalized = String(name ?? '').trim();
  if (!normalized) return '';

  for (const [pattern, group] of getBidKingHeroProfile(profile).qualityNameMatchers) {
    if (pattern.test(normalized)) return group;
  }

  return '';
}

module.exports = {
  ETHAN_MONITOR_PROFILE,
  ELSA_MONITOR_PROFILE,
  getBidKingHeroProfile,
  resolveQualityGroupFromId,
  resolveQualityGroupFromName,
};
