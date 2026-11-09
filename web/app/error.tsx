"use client";

import { useEffect } from "react";
import StateCard from "@/components/states/StateCard";
import { reportError } from "@/lib/report-error";

// Shown when a page crashes. The crash is reported so the tech team gets an alert.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportError(error, { digest: error.digest }), [error]);
  return (
    <StateCard icon="film" title="Something went wrong" action={{ label: "Try again", onClick: reset, primary: true }}>
      This page hit a problem. Our team has been told. Try again, or go back to the home page.
    </StateCard>
  );
}
