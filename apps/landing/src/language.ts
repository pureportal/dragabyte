const storageKey = "dragabyte.language";
const languages = ["en", "de"];
const switcher = document.querySelector<HTMLAnchorElement>("a[data-language]")!;

function storedLanguage(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function browserLanguage(): string | undefined {
  return navigator.languages
    .map((language) => language.slice(0, 2).toLowerCase())
    .find((language) => languages.includes(language));
}

const preferred = storedLanguage() ?? (document.documentElement.lang === "en" ? browserLanguage() : undefined);
if (preferred === switcher.dataset.language) {
  location.replace(`${switcher.href}${location.hash}`);
}

switcher.addEventListener("click", () => {
  try {
    localStorage.setItem(storageKey, switcher.dataset.language!);
  } catch {
    return;
  }
});
