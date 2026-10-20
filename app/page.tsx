import type { Metadata } from "next";
import Link from "next/link";

import "./landing.css";

import { CtaActions } from "@/components/landing/cta-actions";
import { styles } from "@/components/landing/styles";
import { DemoSelectionProvider } from "@/components/landing/demo-selection";
import { ExplanationDemo } from "@/components/landing/explanation-demo";
import { HeroMap } from "@/components/landing/hero-map";
import { LandingIntake } from "@/components/landing/landing-intake";
import { TopbarActions } from "@/components/landing/topbar-actions";

export const metadata: Metadata = {
  title: "Anatomy — See the shape of the code you inherited",
  description:
    "Anatomy maps the relationships between files in a repository, explains each one in plain English, and lets your team explore the same map.",
};

function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="14" cy="9" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="14" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5.7 5.2 12.3 8M12.3 10 5.7 12.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <header className={styles.topbar}>
        <Link className={styles.wordmark} href="/" aria-label="Anatomy, home">
          <span className={styles.mark}>
            <Mark />
          </span>
          <span>Anatomy</span>
        </Link>
        <TopbarActions />
      </header>

      <main id="main">
        <DemoSelectionProvider>
          <section className={styles.hero} aria-labelledby="hero-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>Repo intelligence</p>
              <h1 id="hero-title">See the shape of the code you inherited.</h1>
              <p className={styles.lede}>
                Anatomy maps how every file in a repository connects, then
                explains each one in plain English. Point it at a repo and stop
                scrolling through folders hoping something clicks.
              </p>

              <LandingIntake />

              <p className={styles.fineprint}>
                Public repositories only. Anatomy reads the archive and never
                executes your code.
              </p>
              <p className={styles.fineprint}>
                Sign in to map a repository. Your first map takes about a minute;
                larger repositories take a little longer.
              </p>
            </div>

            <HeroMap />
          </section>

          <section className={styles.section} id="how" aria-labelledby="how-title">
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>How it works</p>
                <h2 id="how-title">Three passes, then a map you can read.</h2>
              </div>
              <p className={styles.sectionNote}>
                No IDE plugin, no agent in your terminal. Anatomy reads the
                repository and writes down what it finds.
              </p>
            </div>
            <ol className={styles.steps}>
              <li className={styles.step}>
                <span className={styles.stepNum}>01 — Ingest</span>
                <h3>Point at a repository</h3>
                <p>
                  Paste a public repository URL. Anatomy fetches a read-only
                  archive, records the commit it came from, and respects the
                  ignore rules it finds.
                </p>
                <span className={styles.stepDetail}>archive + commit</span>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum}>02 — Resolve</span>
                <h3>Follow every link</h3>
                <p>
                  Imports, re-exports, dynamic loads and type-only references are
                  matched to real files. Anything that cannot be resolved is
                  reported with a reason, not guessed.
                </p>
                <span className={styles.stepDetail}>
                  imports · exports · dynamic loads
                </span>
              </li>
              <li className={styles.step}>
                <span className={styles.stepNum}>03 — Explain</span>
                <h3>Say what a file is for</h3>
                <p>
                  Each file gets a role and a short explanation written from its
                  real neighbours. The cache read sits inside the traced call, so
                  a hit is visible as a run with no model call.
                </p>
                <span className={styles.stepDetail}>
                  role + summary + neighbours
                </span>
              </li>
            </ol>
          </section>

          <section
            className={styles.section}
            id="files"
            aria-labelledby="files-title"
          >
            <div className={styles.sectionHead}>
              <div>
                <p className={styles.eyebrow}>Explanations</p>
                <h2 id="files-title">A file is not its filename.</h2>
              </div>
              <p className={styles.sectionNote}>
                Select a node on the map above, or pick one here. The panel reads
                from the same map your team sees.
              </p>
            </div>

            <ExplanationDemo />
          </section>
        </DemoSelectionProvider>

        <section className={styles.cta} aria-labelledby="cta-title">
          <div>
            <h2 id="cta-title">Start with the repo nobody wants to touch.</h2>
            <p>
              Paste the URL. In a minute you will know which files hold the app
              together and which ones you can safely ignore.
            </p>
          </div>
          <CtaActions />
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerLeft}>
            <Link
              className={styles.wordmark}
              href="/"
              aria-label="Anatomy, back to top"
            >
              <span className={styles.mark}>
                <Mark size={16} />
              </span>
              <span>Anatomy</span>
            </Link>
            <span className={styles.footerCopy}>© 2026 Anatomy</span>
          </div>
          <nav className={styles.footerNav} aria-label="Footer">
            <Link href="/sign-in">Sign in</Link>
            <Link href="/sign-up">Sign up</Link>
            <a href="#main">Back to top</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
