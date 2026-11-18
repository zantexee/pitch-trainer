import { useEffect } from 'react';
import { DomTranslator } from './translator';
import { RO } from './ro';
import { updateSettings, useSettings } from '../lib/settings';

export type Lang = 'en' | 'ro';
export type LangSetting = 'auto' | Lang;

export function resolveLang(setting: LangSetting): Lang {
  if (setting !== 'auto') return setting;
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith('ro')) ? 'ro' : 'en';
}

const translator = new DomTranslator();

/** Applies the chosen UI language to the whole page. */
export function useLanguage() {
  const s = useSettings();
  const lang = resolveLang(s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    translator.set(lang === 'ro' ? RO : null);
  }, [lang]);
}

export function LanguagePicker() {
  const s = useSettings();
  const opts: [LangSetting, string][] = [
    ['auto', 'Automatic (phone language)'],
    ['en', 'English'],
    ['ro', 'Română'],
  ];
  return (
    <div className="chips" role="radiogroup" aria-label="Language">
      {opts.map(([id, label]) => (
        <button key={id} role="radio" aria-checked={s.lang === id} className={`chip ${s.lang === id ? 'on' : ''}`} onClick={() => updateSettings({ lang: id })} translate={id === 'auto' ? undefined : 'no'}>
          {label}
        </button>
      ))}
    </div>
  );
}
