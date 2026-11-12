// Jazyky podporované Soniox (rozpoznávanie, preklad aj syntéza reči).
// sk = názov v slovenčine (UI), en = názov pre jazykový model, native = vlastný názov.
export const LANGUAGES = [
  { code: 'af', sk: 'afrikánčina', en: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', sk: 'albánčina', en: 'Albanian', native: 'Shqip' },
  { code: 'ar', sk: 'arabčina', en: 'Arabic', native: 'العربية' },
  { code: 'az', sk: 'azerbajdžančina', en: 'Azerbaijani', native: 'Azərbaycanca' },
  { code: 'eu', sk: 'baskičtina', en: 'Basque', native: 'Euskara' },
  { code: 'be', sk: 'bieloruština', en: 'Belarusian', native: 'Беларуская' },
  { code: 'bn', sk: 'bengálčina', en: 'Bengali', native: 'বাংলা' },
  { code: 'bs', sk: 'bosniačtina', en: 'Bosnian', native: 'Bosanski' },
  { code: 'bg', sk: 'bulharčina', en: 'Bulgarian', native: 'Български' },
  { code: 'ca', sk: 'katalánčina', en: 'Catalan', native: 'Català' },
  { code: 'zh', sk: 'čínština', en: 'Chinese', native: '中文' },
  { code: 'hr', sk: 'chorvátčina', en: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', sk: 'čeština', en: 'Czech', native: 'Čeština' },
  { code: 'da', sk: 'dánčina', en: 'Danish', native: 'Dansk' },
  { code: 'nl', sk: 'holandčina', en: 'Dutch', native: 'Nederlands' },
  { code: 'en', sk: 'angličtina', en: 'English', native: 'English' },
  { code: 'et', sk: 'estónčina', en: 'Estonian', native: 'Eesti' },
  { code: 'fi', sk: 'fínčina', en: 'Finnish', native: 'Suomi' },
  { code: 'fr', sk: 'francúzština', en: 'French', native: 'Français' },
  { code: 'gl', sk: 'galícijčina', en: 'Galician', native: 'Galego' },
  { code: 'de', sk: 'nemčina', en: 'German', native: 'Deutsch' },
  { code: 'el', sk: 'gréčtina', en: 'Greek', native: 'Ελληνικά' },
  { code: 'gu', sk: 'gudžarátčina', en: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'he', sk: 'hebrejčina', en: 'Hebrew', native: 'עברית' },
  { code: 'hi', sk: 'hindčina', en: 'Hindi', native: 'हिन्दी' },
  { code: 'hu', sk: 'maďarčina', en: 'Hungarian', native: 'Magyar' },
  { code: 'id', sk: 'indonézština', en: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'it', sk: 'taliančina', en: 'Italian', native: 'Italiano' },
  { code: 'ja', sk: 'japončina', en: 'Japanese', native: '日本語' },
  { code: 'kn', sk: 'kannadčina', en: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'kk', sk: 'kazaština', en: 'Kazakh', native: 'Қазақша' },
  { code: 'ko', sk: 'kórejčina', en: 'Korean', native: '한국어' },
  { code: 'lv', sk: 'lotyština', en: 'Latvian', native: 'Latviešu' },
  { code: 'lt', sk: 'litovčina', en: 'Lithuanian', native: 'Lietuvių' },
  { code: 'mk', sk: 'macedónčina', en: 'Macedonian', native: 'Македонски' },
  { code: 'ms', sk: 'malajčina', en: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ml', sk: 'malajálamčina', en: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', sk: 'maráthčina', en: 'Marathi', native: 'मराठी' },
  { code: 'no', sk: 'nórčina', en: 'Norwegian', native: 'Norsk' },
  { code: 'fa', sk: 'perzština', en: 'Persian', native: 'فارسی' },
  { code: 'pl', sk: 'poľština', en: 'Polish', native: 'Polski' },
  { code: 'pt', sk: 'portugalčina', en: 'Portuguese', native: 'Português' },
  { code: 'pa', sk: 'pandžábčina', en: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ro', sk: 'rumunčina', en: 'Romanian', native: 'Română' },
  { code: 'ru', sk: 'ruština', en: 'Russian', native: 'Русский' },
  { code: 'sr', sk: 'srbčina', en: 'Serbian', native: 'Српски' },
  { code: 'sk', sk: 'slovenčina', en: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', sk: 'slovinčina', en: 'Slovenian', native: 'Slovenščina' },
  { code: 'es', sk: 'španielčina', en: 'Spanish', native: 'Español' },
  { code: 'sw', sk: 'svahilčina', en: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', sk: 'švédčina', en: 'Swedish', native: 'Svenska' },
  { code: 'tl', sk: 'tagalčina', en: 'Tagalog', native: 'Tagalog' },
  { code: 'ta', sk: 'tamilčina', en: 'Tamil', native: 'தமிழ்' },
  { code: 'te', sk: 'telugčina', en: 'Telugu', native: 'తెలుగు' },
  { code: 'th', sk: 'thajčina', en: 'Thai', native: 'ไทย' },
  { code: 'tr', sk: 'turečtina', en: 'Turkish', native: 'Türkçe' },
  { code: 'uk', sk: 'ukrajinčina', en: 'Ukrainian', native: 'Українська' },
  { code: 'ur', sk: 'urdčina', en: 'Urdu', native: 'اردو' },
  { code: 'vi', sk: 'vietnamčina', en: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', sk: 'waleština', en: 'Welsh', native: 'Cymraeg' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export const isLanguage = (code) => BY_CODE.has(code);
export const language = (code) => BY_CODE.get(code) || { code, sk: code, en: code, native: code };

/** "Slovenčina" – názov s veľkým začiatočným písmenom pre tlačidlá. */
export function languageLabel(code) {
  const name = language(code).sk;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
