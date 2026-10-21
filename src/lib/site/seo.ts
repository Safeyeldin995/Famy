import wordmark from "@/assets/famy-wordmark.png";

export const SITE_ORIGIN = "https://famy-chi.vercel.app";

type Language = "ar" | "en";
type Copy = Record<Language, { title: string; description: string }>;

export function siteLanguage(
  matches: ReadonlyArray<{ routeId: string; loaderData?: unknown }>,
): Language {
  const rootData = matches.find((match) => match.routeId === "__root__")?.loaderData;
  return (rootData as { language?: string } | undefined)?.language === "ar" ? "ar" : "en";
}

export function siteHead(path: string, copy: Copy, language: Language) {
  const { title, description } = copy[language];
  const url = new URL(path, SITE_ORIGIN).href;
  const image = new URL(wordmark, SITE_ORIGIN).href;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: url },
      { property: "og:site_name", content: "Famy" },
      { property: "og:locale", content: language === "ar" ? "ar_EG" : "en_EG" },
      { property: "og:locale:alternate", content: language === "ar" ? "en_EG" : "ar_EG" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: image },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_ORIGIN}/#organization`,
      name: "Famy",
      url: SITE_ORIGIN,
      logo: new URL(wordmark, SITE_ORIGIN).href,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      name: "Famy",
      url: SITE_ORIGIN,
      publisher: { "@id": `${SITE_ORIGIN}/#organization` },
    },
  ],
};
