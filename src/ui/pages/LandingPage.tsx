import { ContentLayout, Header } from "@cloudscape-design/components";

export function LandingPage() {
  return (
    <ContentLayout header={<Header variant="h1">RoleCraft</Header>}>
      Build AWS IAM policies in your browser.
    </ContentLayout>
  );
}
