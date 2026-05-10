/** Minimal head-derived metadata from full HTML (parsed in worker via DOMParser). */
export type HeadMeta = {
  title?: string;
  metaName?: Record<string, string>;
  metaProperty?: Record<string, string>;
  metaTwitter?: Record<string, string>;
  canonicalHref?: string;
  htmlLang?: string;
};

export function extractHeadMeta(rawHtml: string): HeadMeta {
  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const metaName: Record<string, string> = {};
    const metaProperty: Record<string, string> = {};
    const metaTwitter: Record<string, string> = {};

    for (const meta of Array.from(doc.querySelectorAll("meta"))) {
      const name = meta.getAttribute("name")?.toLowerCase();
      const property = meta.getAttribute("property")?.toLowerCase();
      const content = meta.getAttribute("content") ?? "";
      if (name?.startsWith("twitter:")) {
        metaTwitter[name] = content;
      } else if (name) {
        metaName[name] = content;
      }
      if (property) {
        metaProperty[property] = content;
      }
    }

    const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? undefined;
    const htmlLang = doc.documentElement.getAttribute("lang") ?? undefined;
    const title = doc.querySelector("title")?.textContent?.trim() || undefined;

    return {
      title,
      metaName: Object.keys(metaName).length ? metaName : undefined,
      metaProperty: Object.keys(metaProperty).length ? metaProperty : undefined,
      metaTwitter: Object.keys(metaTwitter).length ? metaTwitter : undefined,
      canonicalHref: canonical,
      htmlLang,
    };
  } catch {
    return {};
  }
}
