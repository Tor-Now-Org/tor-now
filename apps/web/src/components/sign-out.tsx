"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session.tsx";
import { Button, Note } from "./ui.tsx";

/**
 * Leaving.
 *
 * There was no way out of the application: the customer drawer had a control
 * that signed you out but was labelled "back to customer", and the owner and
 * administrator screens had nothing at all. Signing out is one action in four
 * places, so it is one component — a screen that grows an account menu later
 * gets the same words and the same behaviour without deciding anything.
 *
 * It always lands on the customer screen rather than reloading wherever you
 * were, because every other screen requires a session and would bounce you.
 */
export const SignOutButton = ({
  label,
  hint,
  onSignedOut,
}: {
  label: string;
  hint?: string;
  /** Runs instead of navigating, for a screen that closes its own drawer. */
  onSignedOut?: () => void;
}) => {
  const { signOut } = useSession();
  const router = useRouter();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Button
        intent="quiet"
        onClick={() => {
          signOut();
          if (onSignedOut === undefined) router.push("/");
          else onSignedOut();
        }}
      >
        {label}
      </Button>
      {hint !== undefined && <Note>{hint}</Note>}
    </div>
  );
};
