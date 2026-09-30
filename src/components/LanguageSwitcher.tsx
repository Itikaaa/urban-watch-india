import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n-provider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useT();
  return (
    <div
      className="flex overflow-hidden rounded-md border border-border"
      role="group"
      aria-label={t("language")}
    >
      <Button
        type="button"
        size="sm"
        variant={locale === "en" ? "default" : "ghost"}
        className="rounded-none px-2.5"
        onClick={() => setLocale("en")}
      >
        EN
      </Button>
      <Button
        type="button"
        size="sm"
        variant={locale === "hi" ? "default" : "ghost"}
        className="rounded-none px-2.5"
        onClick={() => setLocale("hi")}
      >
        हिं
      </Button>
    </div>
  );
}
