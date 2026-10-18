import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useCopy } from "../common/clipboard";

export function DesktopOnlyCard() {
  const { copy, modal } = useCopy();
  const canShare = typeof navigator.share === "function";
  const share = async () => {
    try {
      await navigator.share({ title: "RoleCraft", url: location.href });
    } catch {
      // AbortError means the person cancelled; any other failure leaves Copy link available.
    }
  };
  return (
    <div className="rc-page">
      <Container
        header={<Header variant="h2">Works best on a laptop or desktop</Header>}
      >
        <SpaceBetween size="m">
          <Box>
            The builder needs a screen at least 1024 pixels wide. Open this link
            on a computer to keep going.
          </Box>
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="primary" onClick={() => void copy(location.href)}>
              Copy link
            </Button>
            {canShare && <Button onClick={() => void share()}>Share</Button>}
          </SpaceBetween>
          {modal}
        </SpaceBetween>
      </Container>
    </div>
  );
}
