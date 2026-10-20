import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Input, { type InputProps } from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from "react";
import { useStore } from "zustand";
import { searchServices } from "../../../core/catalog/catalog";
import { POPULAR } from "../../../core/catalog/curated";
import type { ServiceIndexEntry } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { CatalogContext } from "../../../state/catalog";
import { newGrantFor } from "../../../state/model-ops";

export const SERVICE_SEARCH_ID = "service-search";

const listStyle = { listStyle: "none", margin: 0, padding: 0 } as const;
const rowStyle = { display: "flex", justifyContent: "space-between", alignItems: "center" } as const;

const hiddenStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

interface Actions {
  choose(key: string): void;
  pending: ReadonlySet<string>;
}

/** Memoised: typing in the search or editing a grant must not re-render every list (A–Z alone is ~450 buttons). */
const ServiceList = memo(function ServiceList(props: {
  label?: string;
  entries: ServiceIndexEntry[];
  actions: Actions;
  counts?: Map<string, number>;
}): JSX.Element {
  return (
    <ul style={listStyle} aria-label={props.label}>
      {props.entries.map((e) => (
        <li key={e.key} style={rowStyle}>
          <Button
            variant="link"
            disabled={props.actions.pending.has(e.key)}
            onClick={() => props.actions.choose(e.key)}
          >
            {e.name}
          </Button>
          {props.counts && (
            <span>
              {props.counts.get(e.key)}
              <span style={hiddenStyle}> {props.counts.get(e.key) === 1 ? "permission" : "permissions"}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
});

/** Children mount only once expanded: the A-Z list alone is ~450 buttons. */
function LazySection(props: { title: string; children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <ExpandableSection headerText={props.title} expanded={open} onChange={(e) => setOpen(e.detail.expanded)}>
      {open && props.children}
    </ExpandableSection>
  );
}

const byName = (a: ServiceIndexEntry, b: ServiceIndexEntry): number => a.name.localeCompare(b.name);

export function ServiceSidebar(): JSX.Element {
  const catalog = useContext(CatalogContext);
  const index = useStore(catalog, (s) => s.index);
  const indexStatus = useStore(catalog, (s) => s.indexStatus);
  // The service of each grant, joined: a string stays equal while an edit leaves the services alone.
  const grantServices = useBuilderStore((s) => s.model.grants.map((g) => g.service).join(","));
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const wrap = useRef<HTMLDivElement | null>(null);
  const input = useRef<InputProps.Ref | null>(null);

  useEffect(() => {
    void catalog.getState().ensureIndex();
  }, [catalog]);

  // Cloudscape's Input has no id prop, and the "Add permission" button needs one to focus it.
  useEffect(() => {
    const el = wrap.current?.querySelector("input");
    if (el) el.id = SERVICE_SEARCH_ID;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grants restored while the index was failing have their services in "error" too, and ensureServices skips those,
  // so once the index loads they are retried here instead of waiting for a second Retry on each grant.
  const retryIndex = async (): Promise<void> => {
    await catalog.getState().ensureIndex();
    const { indexStatus, status, retry } = catalog.getState();
    if (indexStatus !== "ready") return;
    const used = new Set(useBuilderStore.getState().model.grants.map((g) => g.service));
    await Promise.all([...used].filter((k) => status[k] === "error").map((k) => retry(k)));
  };

  const choose = useCallback((key: string): void => {
    // The ref guards synchronously; state alone would let a fast double click add two grants.
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setPending(new Set(inFlight.current));
    setFailed(null);
    void (async () => {
      const { ensureServices, retry } = catalog.getState();
      // ensureServices skips keys already in error, so a failed service has to go through retry.
      await (catalog.getState().status[key] === "error" ? retry(key) : ensureServices([key]));
      const { services, status } = catalog.getState();
      const svc = services[key];
      if (status[key] === "ready" && svc) {
        const grant = newGrantFor(svc);
        const b = useBuilderStore.getState();
        b.addGrant(grant);
        b.setStep(1);
        b.focus("grant:" + grant.id);
      } else {
        setFailed(key);
      }
      inFlight.current.delete(key);
      setPending(new Set(inFlight.current));
    })();
  }, [catalog]);
  const actions: Actions = useMemo(() => ({ choose, pending }), [choose, pending]);

  const results = useMemo(() => (index ? searchServices(index, query, 20) : []), [index, query]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const service of grantServices ? grantServices.split(",") : []) m.set(service, (m.get(service) ?? 0) + 1);
    return m;
  }, [grantServices]);
  const sections = useMemo(() => {
    if (!index) return null;
    const byKey = new Map(index.services.map((s) => [s.key, s]));
    const cats = new Map<string, ServiceIndexEntry[]>();
    for (const s of index.services) cats.set(s.category, [...(cats.get(s.category) ?? []), s]);
    const categories = [...cats.entries()]
      .map(([name, list]) => ({ name, list: [...list].sort(byName) }))
      .sort((a, b) => (a.name === "Other" ? 1 : b.name === "Other" ? -1 : a.name.localeCompare(b.name)));
    return {
      byKey,
      popular: POPULAR.flatMap((k) => byKey.get(k) ?? []),
      categories,
      all: [...index.services].sort(byName),
    };
  }, [index]);

  const inRole = useMemo(
    () => (sections ? [...counts.keys()].flatMap((k) => sections.byKey.get(k) ?? []) : []),
    [sections, counts],
  );
  const failedName = failed && sections ? (sections.byKey.get(failed)?.name ?? failed) : failed;

  return (
    <SpaceBetween size="m">
      <div ref={wrap}>
        <Input
          ref={input}
          type="search"
          ariaLabel="Search services"
          placeholder="Search 450+ services"
          value={query}
          onChange={(e) => setQuery(e.detail.value)}
          onKeyDown={(e) => {
            const first = results[0];
            if (e.detail.key === "Enter" && first) choose(first.key);
          }}
        />
      </div>
      {failed && (
        <Alert type="error" action={<Button onClick={() => choose(failed)}>Retry</Button>}>
          Couldn't load {failedName}.
        </Alert>
      )}
      {indexStatus === "error" && (
        <Alert type="error" action={<Button onClick={() => void retryIndex()}>Retry</Button>}>
          Couldn't load the AWS service list.
        </Alert>
      )}
      {indexStatus !== "error" && !sections && <Box color="text-status-inactive">Loading services…</Box>}
      {query.trim() !== "" &&
        sections &&
        (results.length > 0 ? (
          <ServiceList label="Search results" entries={results} actions={actions} />
        ) : (
          <Box color="text-status-inactive">No services match.</Box>
        ))}
      {sections && (
        <>
          {inRole.length > 0 && (
            <section>
              <Box variant="h3">In this role</Box>
              <ServiceList entries={inRole} actions={actions} counts={counts} />
            </section>
          )}
          <section>
            <Box variant="h3">Popular</Box>
            <ServiceList entries={sections.popular} actions={actions} />
          </section>
          <section>
            <Box variant="h3">Browse by category</Box>
            {sections.categories.map((c) => (
              <LazySection key={c.name} title={c.name}>
                <ServiceList entries={c.list} actions={actions} />
              </LazySection>
            ))}
          </section>
          <LazySection title="A–Z">
            <ServiceList entries={sections.all} actions={actions} />
          </LazySection>
        </>
      )}
    </SpaceBetween>
  );
}
