// редактируемые реквизиты не меняют исходную модель продаж и историю закупок
export const OWNER_ROLES = ['Владелец', 'Директор'];

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeProfile(raw, base) {
  const profile = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return profile;
  for (const [key, max] of [['name', 100], ['short', 40], ['type', 100]]) {
    const value = text(raw[key], max);
    if (value) profile[key] = value;
  }
  if (Number.isFinite(raw.targetFoodCost) && raw.targetFoodCost >= 0.05 && raw.targetFoodCost <= 0.95) profile.targetFoodCost = raw.targetFoodCost;
  if (raw.locations && typeof raw.locations === 'object') {
    profile.locations = {};
    for (const loc of base.locations) {
      const value = raw.locations[loc.id];
      if (!value || typeof value !== 'object') continue;
      const patch = {};
      if (text(value.name, 100)) patch.name = text(value.name, 100);
      if (typeof value.address === 'string') patch.address = text(value.address, 200);
      const time = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (time.test(value.receivingStart) && time.test(value.receivingEnd) && value.receivingStart < value.receivingEnd) {
        patch.receivingStart = value.receivingStart;
        patch.receivingEnd = value.receivingEnd;
      }
      profile.locations[loc.id] = patch;
    }
  }
  if (Array.isArray(raw.team) && raw.team.length > 0 && raw.team.length <= 30) {
    const team = raw.team.map((member) => ({ name: text(member?.name, 100), email: text(member?.email, 120).toLowerCase(), role: text(member?.role, 80) }));
    if (team.every((m) => m.name && m.role && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) && new Set(team.map((m) => m.email)).size === team.length && team.some((m) => OWNER_ROLES.includes(m.role))) profile.team = team;
  }
  return profile;
}

export function applyProfile(base, raw) {
  const profile = normalizeProfile(raw, base);
  return { ...base, ...profile, locations: base.locations.map((loc) => ({ ...loc, ...profile.locations?.[loc.id] })), team: (profile.team ?? base.team).map((m) => ({ ...m })) };
}
