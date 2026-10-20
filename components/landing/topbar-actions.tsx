"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

import { styles } from "@/components/landing/styles";

import { ThemeSwitch } from "./theme-switch";

export function TopbarActions() {
  const { isSignedIn } = useAuth();

  return (
    <div className={styles.topbarRight}>
      {isSignedIn ? (
        <Link
          className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSmall}`}
          href="/analyses"
        >
          Open workspace
        </Link>
      ) : (
        <>
          <Link className={styles.topbarLink} href="/sign-in">
            Sign in
          </Link>
          <Link
            className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
            href="/sign-up"
          >
            Get started
          </Link>
        </>
      )}
      <ThemeSwitch />
    </div>
  );
}
