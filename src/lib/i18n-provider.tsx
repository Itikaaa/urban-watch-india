import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getLocale, setActiveLocale, translate, type Locale, type MessageKey } from "@/lib/i18n";

const STORAGE = "drishti-locale";

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem(STORAGE) === "hi" ? "hi" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale);

  useEffect(() => {
    const stored = readStoredLocale();
    setLocaleState(stored);
    setActiveLocale(stored);
    document.documentElement.lang = stored === "hi" ? "hi" : "en";
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        setActiveLocale(next);
        window.localStorage.setItem(STORAGE, next);
        document.documentElement.lang = next === "hi" ? "hi" : "en";
      },
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useT must be used inside LanguageProvider");
  return value;
}
