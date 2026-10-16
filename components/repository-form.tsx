"use client";

import { useRouter } from "next/navigation";
import { useState, FormEvent } from "react";

import { PlusIcon } from "@/components/icons";

export function RepositoryForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!url.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to start analysis");
      }

      if (data.isNew) {
        // Redirect to progress page for new analyses
        router.push(`/analyses/${data.analysisId}/progress`);
      } else {
        // Redirect to existing analysis
        router.push(`/analyses/${data.analysisId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto mb-6">
      <div className="flex gap-2">
        <label htmlFor="repository-url" className="sr-only">
          Repository URL
        </label>
        <input
          id="repository-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          className="flex-1 rounded-lg border border-line bg-surface px-4 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-2 focus:outline-accent disabled:opacity-50"
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={isSubmitting || !url.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90 focus:outline-2 focus:outline-offset-2 focus:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <PlusIcon size={16} />
          <span>{isSubmitting ? "Starting…" : "Analyze"}</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-fg-muted">
        Public repositories only. No token is stored. Supported formats:{" "}
        <code className="font-mono bg-surface px-1 rounded">owner/repo</code>{" "},
        <code className="font-mono bg-surface px-1 rounded">https://github.com/owner/repo</code>{" "},
        <code className="font-mono bg-surface px-1 rounded">git@github.com:owner/repo</code>.
      </p>
    </form>
  );
}