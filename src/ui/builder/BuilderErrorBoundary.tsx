import Alert from "@cloudscape-design/components/alert";
import Button from "@cloudscape-design/components/button";
import { Component, type ReactNode } from "react";
import { useBuilderStore } from "../../state/builder";

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
  epoch: number;
}

export class BuilderErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, epoch: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("RoleCraft builder crashed", error);
  }

  private reset = (): void => {
    useBuilderStore.getState().reset();
    history.replaceState(null, "", location.pathname);
    this.setState((s) => ({ failed: false, epoch: s.epoch + 1 }));
  };

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="rc-page">
          <Alert
            type="error"
            header="Something went wrong in the builder."
            action={<Button onClick={this.reset}>Reset builder</Button>}
          >
            Resetting clears your current role and the link data, then starts
            fresh.
          </Alert>
        </div>
      );
    }
    return (
      <div key={this.state.epoch} className="rc-builder-root">
        {this.props.children}
      </div>
    );
  }
}
