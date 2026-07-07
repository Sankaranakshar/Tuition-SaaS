import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";

// i18n wrapper (DEV_PLAN E5.5). Launch is English-only, but every new string
// goes through `t()` from day one so Hindi is a locale file, not a rewrite.
// Import this module once (in main.tsx) before the app renders.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    // React already escapes output.
    escapeValue: false,
  },
});

export default i18n;
