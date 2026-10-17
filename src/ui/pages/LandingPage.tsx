import {
  CaretDown,
  FileText,
  Key,
  Layout,
  ListChecks,
  Monitor,
  ShieldCheck,
  Stack,
  Terminal,
  UsersThree,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface IndexInfo {
  generatedAt?: string;
  services?: unknown[];
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
          <div className="lp-preview" aria-label="Example policy preview">
            <div className="lp-ph">
              <FileText size={16} />
              S3 folder — read only <span className="d">· template</span>
            </div>
            <div className="lp-lines">
              <div className="lp-line">
                <span className="lp-who">
                  <UsersThree size={14} />
                  analytics-team
                </span>{" "}
                can
              </div>
              <div className="lp-line">
                <span className="lp-sel v">
                  list + read
                  <CaretDown size={12} />
                </span>{" "}
                files in{" "}
                <span className="lp-sel">
                  data-lake / reports/
                  <CaretDown size={12} />
                </span>
              </div>
            </div>
            <pre className="lp-pre">
              {"{ "}
              <span className="k">"Action"</span>: <span className="s">"s3:ListBucket"</span>,{"\n  "}
              <span className="k">"Resource"</span>: <span className="s">"arn:aws:s3:::data-lake"</span>,{"\n  "}
              <span className="k">"Condition"</span>
              {": { "}
              <span className="k">"StringLike"</span>
              {": {\n    "}
              <span className="k">"s3:prefix"</span>: <span className="c">"reports/*"</span>
              {" } } },\n{ "}
              <span className="k">"Action"</span>: <span className="s">"s3:GetObject"</span>,{"\n  "}
              <span className="k">"Resource"</span>: <span className="c">"arn:aws:s3:::data-lake/reports/*"</span>
              {" }"}
            </pre>
          </div>
        </div>
      </section>
      <section className="lp-band">
        {features.map((f) => (
          <div className="lp-feat" key={f.title}>
            <div className="lp-fi">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>
      <DesktopNote />
      <footer className="lp-foot">
        <div className="lp-foot-in">
          <span>
            Built by <a href="https://omhinge.cloud">Om Hinge</a>
          </span>
          <span className="sp" />
          {info?.generatedAt && <span>AWS data updated {info.generatedAt}</span>}
          <span>Not affiliated with Amazon Web Services</span>
        </div>
      </footer>
    </div>
  );
}
