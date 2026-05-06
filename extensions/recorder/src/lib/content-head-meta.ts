/**
 * Content-script copy of head extraction logic — kept separate from `head-meta.ts`
 * so Rollup does not emit a shared chunk. Chrome injects content scripts as classic
 * scripts; `import` from another file fails with "Cannot use import statement outside a module".
 *
 * Keep behavior aligned with `head-meta.ts` (same outputs for the same HTML).
 */
import type { HeadMeta } from "./head-meta";

export function extractHeadMetaForContent(rawHtml: string): HeadMeta {
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
