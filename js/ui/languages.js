// Výber jazyka: moje jazyky + pridanie ďalšieho zo všetkých podporovaných.
import { LANGUAGES, languageLabel, language } from '../core/languages.js';
import { store } from '../store.js';
import { $ } from './dom.js';

const dialog = $('#dlgLang');
let resolvePick = null;

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function button(code, current) {
  const node = document.createElement('button');
  node.type = 'button';
  node.dataset.code = code;
  if (code === current) node.setAttribute('aria-current', 'true');
  const name = document.createElement('span');
  name.textContent = languageLabel(code);
  const native = document.createElement('small');
  native.textContent = language(code).native;
  node.append(name, native);
  return node;
}

function render(current) {
  const mine = store.all.myLanguages;
  $('#langMine').replaceChildren(...mine.map((code) => button(code, current)));
  const query = fold($('#langSearch').value.trim());
  const rest = LANGUAGES.filter((l) => !mine.includes(l.code))
    .filter((l) => !query || [l.sk, l.en, l.native, l.code].some((v) => fold(v).includes(query)))
    .sort((a, b) => a.sk.localeCompare(b.sk, 'sk'));
  $('#langAll').replaceChildren(...rest.map((l) => button(l.code, current)));
}

/** Vráti kód vybraného jazyka (a pridá ho medzi moje), alebo null. */
export function openLanguagePicker({ title, current }) {
  $('#dlgLangTitle').textContent = title;
  $('#langSearch').value = '';
  render(current);
  dialog.dataset.current = current || '';
  dialog.showModal();
  return new Promise((resolve) => {
    resolvePick = resolve;
  });
}

dialog.addEventListener('click', async (event) => {
  if (event.target === dialog || event.target.closest('[data-close]')) {
    dialog.close();
    return;
  }
  const code = event.target.closest('button[data-code]')?.dataset.code;
  if (!code) return;
  if (!store.all.myLanguages.includes(code)) {
    await store.update({ myLanguages: [...store.all.myLanguages, code] });
  }
  const resolve = resolvePick;
  resolvePick = null;
  dialog.close();
  resolve?.(code);
});
dialog.addEventListener('close', () => {
  resolvePick?.(null);
  resolvePick = null;
});
$('#langSearch').addEventListener('input', () => render(dialog.dataset.current));
