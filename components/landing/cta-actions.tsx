"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

import { styles } from "@/components/landing/styles";

export function CtaActions() {
  const { isSignedIn } = useAuth();

  return (
    <div className={styles.ctaActions}>
      <Link
        className={`${styles.btn} ${styles.btnPrimary}`}
        href={isSignedIn ? "/analyses" : "/sign-up"}
      >
        {isSignedIn ? "Open workspace" : "Map a repository"}
      </Link>
      <span className={styles.fineprint}>
        Public repositories only. No install.
      </span>
    </div>
  );
}
