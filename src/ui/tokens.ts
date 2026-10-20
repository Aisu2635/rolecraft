import {
  colorBackgroundContainerContent,
  colorBackgroundLayoutMain,
  colorBorderDividerDefault,
  colorBorderItemFocused,
  colorTextBodyDefault,
  colorTextBodySecondary,
  colorTextLinkDefault,
  fontFamilyBase,
  fontFamilyMonospace,
} from "@cloudscape-design/design-tokens";

/** Expose Cloudscape tokens as CSS variables on body (where the theme-mode class lives, so they resolve per mode). */
export function applyTokenVariables(root: HTMLElement = document.body): void {
  const vars: Record<string, string> = {
    "--rc-bg": colorBackgroundLayoutMain,
    "--rc-panel": colorBackgroundContainerContent,
    "--rc-border": colorBorderDividerDefault,
    "--rc-text": colorTextBodyDefault,
    "--rc-muted": colorTextBodySecondary,
    "--rc-link": colorTextLinkDefault,
    "--rc-focus": colorBorderItemFocused,
    "--rc-font": fontFamilyBase,
    "--rc-mono": fontFamilyMonospace,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}
