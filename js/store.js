// Uloženie nastavení v zariadení. API kľúče idú na Windows do šifrovaného
// úložiska systému (cez desktopový obal), inde do úložiska prehliadača.
import { DEFAULTS, SECRET_KEYS, sanitize, endpoints } from './core/config.js';

const SETTINGS_KEY = 'tlmocnik.settings.v1';
const SECRETS_KEY = 'tlmocnik.secrets.v1';
const desktop = globalThis.desktop;

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
};

class Store {
  #data = sanitize({});
  #listeners = new Set();
  mock = '';

  async load() {
    const params = new URLSearchParams(location.search);
    // Testovací server sa dá zapnúť len pri lokálnom vývoji.
    if (['localhost', '127.0.0.1'].includes(location.hostname)) this.mock = params.get('mock') || '';
    let secrets = {};
    try {
      secrets = desktop?.getSecrets ? await desktop.getSecrets() : read(SECRETS_KEY);
    } catch {
      secrets = {};
    }
    this.#data = sanitize({ ...read(SETTINGS_KEY), ...secrets });
  }

  /** Aktuálne nastavenia vrátane kľúčov. */
  get all() {
    return this.#data;
  }

  get endpoints() {
    return endpoints(this.#data.region, this.mock);
  }

  async update(patch) {
    const before = this.#data;
    this.#data = sanitize({ ...before, ...patch });
    const plain = {};
    for (const key of Object.keys(DEFAULTS)) plain[key] = this.#data[key];
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(plain));
    } catch {
      /* súkromné okno bez úložiska – nastavenia platia do zatvorenia */
    }
    if (SECRET_KEYS.some((key) => before[key] !== this.#data[key])) {
      const secrets = Object.fromEntries(SECRET_KEYS.map((key) => [key, this.#data[key] || '']));
      try {
        if (desktop?.setSecrets) await desktop.setSecrets(secrets);
        else localStorage.setItem(SECRETS_KEY, JSON.stringify(secrets));
      } catch (err) {
        console.error(err);
      }
    }
    const changed = Object.keys(this.#data).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(this.#data[key]));
    if (changed.length) for (const listener of this.#listeners) listener(this.#data, changed);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const store = new Store();
