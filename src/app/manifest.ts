import type { MetadataRoute } from "next";

/** Manifesto do app instalado (PWA) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Genix Agenda",
    short_name: "Genix Agenda",
    description: "Vitrine digital e agenda online para quem atende com hora marcada.",
    start_url: "/admin",
    display: "standalone",
    theme_color: "#99582A",
    background_color: "#FAF7F2",
    icons: [
      { src: "/brand/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
