import { compressTextTree, htmlToTextTree, treeToIndentedText } from "./html-text-tree";

export function transformHtmlToIndentedText(htmlContent?: string): string {
  if (!htmlContent || !htmlContent.trim()) {
    return "";
  }
  const tree = compressTextTree(htmlToTextTree(htmlContent));
  return treeToIndentedText(tree);
}
