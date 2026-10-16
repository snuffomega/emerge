// Hosted-preview-only configuration (Emergent). Inactive for local / Docker runs.
import type { ServerOptions } from "vite";

const active = Boolean(process.env.EMERGENT_OVERLAY_RRWEB);

export function hostedPreviewServer(): Partial<ServerOptions> {
  if (!active) return {};
  return { allowedHosts: true, hmr: { clientPort: Number(process.env.WDS_SOCKET_PORT || 443), protocol: "wss" } };
}

export function hostedPreviewPlugins(): any[] {
  if (!active) return [];
  return [
    {
      name: "hosted-preview-script",
      transformIndexHtml: () => [
        { tag: "script", attrs: { src: "https://assets.emergent.sh/scripts/emergent-main.js" }, injectTo: "head" },
      ],
    },
  ];
}
