import {
  Key,
  Layout,
  ListChecks,
  Monitor,
  ShieldCheck,
  Stack,
  Terminal,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HeroDemo } from "../landing/HeroDemo";

interface IndexInfo {
  generatedAt?: string;
  services?: unknown[];
}

const DATA_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-10-19" -> "19 Oct 2026". generatedAt is a UTC calendar date, so it is formatted in UTC (no day shift). */
export function formatDataDate(generatedAt: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(generatedAt) ? new Date(`${generatedAt}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? DATA_DATE.format(d) : generatedAt;
}

function useIndexInfo(): IndexInfo | null {
  const [info, setInfo] = useState<IndexInfo | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/data/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<IndexInfo>) : null))
      .then((j) => {
        if (live && j) setInfo(j);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return info;
}

function DesktopNote() {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "RoleCraft", url: window.location.href });
    } catch {
      // share dismissed or unavailable
    }
  };
  return (
    <div className="lp-note" data-testid="desktop-note">
      <div className="lp-note-in">
        <Monitor size={18} />
        <span>The builder works best on a laptop or desktop.</span>
        <button type="button" onClick={() => void copy()}>
          {copied ? "Link copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}

const features = [
  {
    icon: <Layout size={20} />,
    title: "Start from a template",
    body: "Common jobs — S3 folder access, GitHub deploys, EC2 operators — ready in a few clicks.",
  },
  {
    icon: <ListChecks size={20} />,
    title: "Choose access visually",
    body: "Write rules as sentences or tick boxes. Folders, tags and service quirks handled for you.",
  },
  {
    icon: <Terminal size={20} />,
    title: "Export and create",
    body: "Policy JSON, trust policy, AWS CLI (bash / PowerShell), Terraform, CloudFormation.",
  },
];

/** Feature cards rise in once as they scroll into view; without IntersectionObserver they are shown at once. */
function FeatureBand() {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState<ReadonlySet<number>>(
    () => new Set(typeof IntersectionObserver === "undefined" ? features.map((_, i) => i) : []),
  );
  useEffect(() => {
    const band = ref.current;
    if (!band || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = Number((e.target as HTMLElement).dataset.idx);
        setShown((prev) => new Set(prev).add(i));
        io.unobserve(e.target);
      }
    });
    band.querySelectorAll(".lp-feat").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <section className="lp-band" ref={ref}>
      {features.map((f, i) => (
        <div
          className={shown.has(i) ? "lp-feat lp-feat-in" : "lp-feat"}
          key={f.title}
          data-idx={i}
          style={{ "--i": i } as CSSProperties}
        >
          <div className="lp-fi">{f.icon}</div>
          <h3>{f.title}</h3>
          <p>{f.body}</p>
        </div>
      ))}
    </section>
  );
}

export function LandingPage() {
  const info = useIndexInfo();
  const count = info?.services?.length;
  const services = count ? `${count} services` : "450+ services";
  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-hero-in">
          <div>
            <div className="lp-kick">IAM policy builder</div>
            <h1>Least-privilege AWS roles, without writing JSON.</h1>
            <p className="lp-sub">
              Pick a template or describe access in plain sentences. Get the policy, the trust policy, and the AWS CLI or
              Terraform to create it.
            </p>
            <div className="lp-ctas">
              <Link className="lp-btn primary" to="/templates">
                Browse templates
              </Link>
              <Link className="lp-btn" to="/builder">
                Start from scratch
              </Link>
            </div>
            <div className="lp-facts">
              <span>
                <ShieldCheck size={16} />
                Runs in your browser
              </span>
              <span>
                <Key size={16} />
                No AWS credentials
              </span>
              <span>
                <Stack size={16} />
                {services}
              </span>
            </div>
          </div>
          <HeroDemo />
        </div>
      </section>
      <FeatureBand />
      <DesktopNote />
      <footer className="lp-foot">
        <div className="lp-foot-in">
          <span>
            Built by <a href="https://omhinge.cloud">Om Hinge</a>
          </span>
          <span className="sp" />
          {info?.generatedAt && <span>AWS data updated {formatDataDate(info.generatedAt)}</span>}
          <span>Not affiliated with Amazon Web Services</span>
        </div>
      </footer>
    </div>
  );
}
