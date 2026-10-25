import type { Metadata } from "next";
import DemoClient from "@/components/DemoClient";

export const metadata: Metadata = {
  title: "Live Demo — Run the Verified Editing Pipeline Yourself",
  description:
    "Run a real Surepix edit in your browser: pick a product photo, choose an edit, and watch the intent router, deterministic command chain and per-element fidelity verification run end to end.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Surepix live demo — verified product-photo editing",
    description:
      "The real pipeline, running in your browser: intent routing, deterministic edits, per-element fidelity verification.",
    type: "website",
  },
};

export default function DemoPage() {
  return <DemoClient />;
}
