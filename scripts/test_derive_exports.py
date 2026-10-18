"""Unit tests for derive_exports.py and check_manifest.py."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import check_manifest  # noqa: E402
import derive_exports as d  # noqa: E402

TF = """resource "aws_iam_role" "gh" {
  name = "gh"

  assume_role_policy = <<-JSON
{
}
JSON
}

# Then also add depends_on = [aws_iam_openid_connect_provider.github] to aws_iam_role.gh.
# resource "aws_iam_openid_connect_provider" "github" {
#   url = "u"
# }
"""

CFN = """# The trust policy uses the GitHub OIDC provider. If your account doesn't have it yet, add this resource and DependsOn: P on Role:
#   P:
#     Type: AWS::IAM::OIDCProvider

Resources:
  Role:
    Type: AWS::IAM::Role
"""


class Derive(unittest.TestCase):
    def test_terraform(self):
        out = d.derive_terraform(TF)
        self.assertIn('\nresource "aws_iam_openid_connect_provider" "github" {\n  url = "u"\n}', out)
        self.assertIn("JSON\n\n  depends_on = [aws_iam_openid_connect_provider.github]\n}", out)

    def test_terraform_without_comment_fails(self):
        with self.assertRaises(d.DeriveError):
            d.derive_terraform(TF.replace("# Then also add", "# Also add"))
        with self.assertRaises(d.DeriveError):
            d.derive_terraform(TF.replace("# }", "#}"))

    def test_cloudformation(self):
        out = d.derive_cloudformation(CFN)
        self.assertIn("Resources:\n  P:\n    Type: AWS::IAM::OIDCProvider\n  Role:\n    DependsOn: P\n", out)

    def test_cloudformation_without_comment_fails(self):
        with self.assertRaises(d.DeriveError):
            d.derive_cloudformation(CFN.replace("DependsOn: P on Role:", "DependsOn on Role"))
        with self.assertRaises(d.DeriveError):
            d.derive_cloudformation(CFN.replace("#   P:", "#   Q:"))

    def test_readme_blocks(self):
        md = "```sh\naws iam get-role\n```\n```powershell\nx\n```\n```json\n{}\n```"
        self.assertEqual(d.readme_blocks(md), [("sh", 2, "aws iam get-role"), ("ps1", 5, "x")])
        with self.assertRaises(d.DeriveError):
            d.readme_blocks("```text\naws iam get-role --role-name r\n```")
        with self.assertRaises(d.DeriveError):
            d.readme_blocks("```sh\naws iam get-role")


class Manifest(unittest.TestCase):
    def test_coherence(self):
        role = {"README.md", "main.tf", "template.yaml", "create-role.sh", "create-role.ps1", "trust.json", "policy.json"}
        self.assertEqual(check_manifest.coherence(role), [])
        self.assertEqual(check_manifest.coherence(role - {"create-role.ps1"}), ["missing create-role.ps1"])
        group = {"README.md", "main.tf", "template.yaml", "attach-policy.sh", "attach-policy.ps1", "trust.json"}
        self.assertEqual(check_manifest.coherence(group), ["trust.json without create-role scripts"])
        self.assertIn("unexpected file x.txt", check_manifest.coherence(role | {"x.txt"}))


if __name__ == "__main__":
    unittest.main()
