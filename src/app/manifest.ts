import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://surepix.app";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Surepix — Verified Product-Photo Editing",
    short_name: "Surepix",
    description:
      "Deterministic e-commerce product-photo editing with per-element brand-asset fidelity verification.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    lang: "en",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
