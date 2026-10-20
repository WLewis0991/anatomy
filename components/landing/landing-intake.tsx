"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { styles } from "@/components/landing/styles";
import {
  normalizeRepositoryUrl,
  PENDING_REPOSITORY_KEY,
} from "@/lib/repository-url";

export function LandingIntake() {
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let normalized: string;
    try {
      normalized = normalizeRepositoryUrl(url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not read that URL.",
      );
      return;
    }

    setError(null);

    try {
      window.sessionStorage.setItem(PENDING_REPOSITORY_KEY, normalized);
    } catch {
      // The saved URL is a convenience. Sign-in still works without it.
    }

    router.push(isSignedIn ? "/analyses" : "/sign-up");
  }

  return (
    <>
      <form className={styles.intake} onSubmit={handleSubmit} noValidate>
        <div className={styles.fieldWrap}>
          <label className="sr-only" htmlFor="repo-url">
            Repository URL
          </label>
          <input
            className={styles.repoInput}
            id="repo-url"
            name="repo"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="github.com/owner/repo"
            aria-describedby="repo-error"
            aria-invalid={error !== null}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (error !== null) setError(null);
            }}
          />
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
          Map a repository
        </button>
      </form>
      <p
        className={[
          styles.fieldError,
          error === null ? "" : styles.isOn,
        ]
          .filter(Boolean)
          .join(" ")}
        id="repo-error"
        role="alert"
      >
        {error}
      </p>
    </>
  );
}
