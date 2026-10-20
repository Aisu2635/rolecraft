import Button from "@cloudscape-design/components/button";
import { useContext, type JSX } from "react";
import { useStore } from "zustand";
import type { SlimService } from "../../../core/types";
import { CatalogContext, type LoadStatus } from "../../../state/catalog";
import { StatusText } from "../../common/StatusText";

export interface ServiceInfo {
  key: string;
  status: LoadStatus | undefined;
  svc: SlimService | undefined;
  name: string;
}

/** What the catalog knows about one service, with a display name that works before it has loaded. */
export function useServiceInfo(key: string): ServiceInfo {
  const catalog = useContext(CatalogContext);
  const status = useStore(catalog, (s) => s.status[key]);
  const svc = useStore(catalog, (s) => s.services[key]);
  const entry = useStore(catalog, (s) => s.index?.services.find((e) => e.key === key));
  return { key, status, svc, name: svc?.name ?? entry?.name ?? key };
}

const rowStyle = { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } as const;

/** The loading, failed or missing state of a service that is not ready, shared by both editors. */
export function ServiceUnavailable(props: { info: ServiceInfo }): JSX.Element {
  const catalog = useContext(CatalogContext);
  const { status, key, name } = props.info;
  if (status === "error") {
    return (
      <div style={rowStyle}>
        <StatusText type="error">Couldn&apos;t load this service.</StatusText>
        <Button onClick={() => void catalog.getState().retry(key)}>Retry</Button>
      </div>
    );
  }
  if (status === "missing") {
    return <StatusText type="warning">Service no longer in AWS data. It is left out of the policy.</StatusText>;
  }
  return <StatusText type="loading">{`Loading ${name}…`}</StatusText>;
}
