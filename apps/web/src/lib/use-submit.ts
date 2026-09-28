"use client";

import { useState } from "react";
import { isApiError } from "@/lib/api/errors.ts";
import { useErrorText } from "@/lib/use-error-text.ts";

/**
 * One press of a sheet's button: busy while it runs, and a refusal said in
 * the reader's words when it fails. Every sheet that saves something uses it.
 */
export const useSubmit = () => {
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
};
