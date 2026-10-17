import { Container, Header, SpaceBetween } from "@cloudscape-design/components";
import { Link } from "react-router-dom";

export function ComingSoon({ title, message }: { title: string; message: string }) {
  return (
    <div className="rc-page">
      <SpaceBetween size="l">
        <Header variant="h1">{title}</Header>
        <Container header={<Header variant="h2">Coming soon</Header>}>
          <SpaceBetween size="s">
            <span>{message}</span>
            <Link to="/">Back to home</Link>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </div>
  );
}
