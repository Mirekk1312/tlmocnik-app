// Preklad chýb služieb do zrozumiteľnej slovenčiny.

export class ServiceError extends Error {
  constructor(message, { code = 0, type = '', service = '' } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.type = type;
    this.service = service;
  }
}

const BY_TYPE = {
  unauthenticated: 'Soniox API kľúč je neplatný. Skontroluj ho v Nastaveniach (aj región projektu).',
  permission_denied: 'Tento Soniox API kľúč nemá povolenie na túto službu. Uprav jeho oprávnenia v Soniox Console.',
  organization_balance_exhausted: 'Na Soniox účte sa minul kredit. Dobi ho v Soniox Console.',
  organization_monthly_budget_exhausted: 'Mesačný limit výdavkov Soniox je vyčerpaný. Zvýš ho v Soniox Console.',
  project_monthly_budget_exhausted: 'Mesačný limit výdavkov Soniox projektu je vyčerpaný. Zvýš ho v Soniox Console.',
  limit_exceeded: 'Soniox hlási prekročený limit požiadaviek. Skús to o chvíľu znova.',
  max_concurrent_connections_reached: 'Príliš veľa otvorených spojení so Soniox. Zavri aplikáciu na iných zariadeniach.',
  model_not_available: 'Zvolený Soniox model nie je dostupný. Skontroluj názov modelu v Pokročilých nastaveniach.',
  voice_not_found: 'Zvolený hlas už neexistuje. Vyber iný v Nastaveniach → Môj hlas.',
  voice_not_ready: 'Hlas sa ešte spracúva. Skús to o pár sekúnd.',
  voice_not_prepared: 'Hlas nie je pripravený pre tento model. Vytvor ho nanovo v Nastaveniach → Môj hlas.',
  voice_failed: 'Hlas sa nepodarilo spracovať. Nahraj novú vzorku.',
  voice_audio_too_long: 'Vzorka hlasu je dlhšia než 2 minúty. Nahraj kratšiu.',
  voice_invalid_audio: 'Vzorku hlasu sa nepodarilo prečítať. Skús inú nahrávku.',
};

export function describeSonioxError({ code, type, message } = {}) {
  if (BY_TYPE[type]) return BY_TYPE[type];
  if (code === 401) return BY_TYPE.unauthenticated;
  if (code === 402) return BY_TYPE.organization_balance_exhausted;
  if (code === 429) return BY_TYPE.limit_exceeded;
  return `Soniox: ${message || type || `chyba ${code}`}`;
}

/** Chyby, pri ktorých má zmysel spojenie otvoriť znova. */
export function isRetriable({ code, type } = {}) {
  return code === 408 || code === 500 || code === 503 || type === 'max_duration_reached';
}
