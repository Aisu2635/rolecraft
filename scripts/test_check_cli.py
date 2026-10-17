"""Unit tests for check_cli.py (run: python -m unittest discover -s scripts -p 'test_*.py')."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import check_cli  # noqa: E402

MODEL = check_cli.Model()


def problems(text: str, dialect: str = "bash", base_dir: str | None = None) -> list[str]:
    cmds = check_cli.extract_commands(text, dialect)
    return [f"{c.line}: {p}" for c in cmds for p in check_cli.check_command(c, MODEL, base_dir)]


def count(text: str, dialect: str = "bash") -> int:
    return len(check_cli.extract_commands(text, dialect))


class BashExtraction(unittest.TestCase):
    def test_plain_and_substitution_and_if(self):
        text = "\n".join(
            [
                'aws iam get-role --role-name "$ROLE_NAME"',
                'ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)',
                "if ! aws iam get-role --role-name x >/dev/null 2>&1; then echo no; fi",
                'if [ -z "$e" ]; then aws iam create-open-id-connect-provider --url https://x --client-id-list sts.amazonaws.com; fi',
                "echo aws iam get-role",  # argument, not a command
            ]
        )
        self.assertEqual(count(text), 4)
        self.assertEqual(problems(text), [])

    def test_backslash_continuation_joined(self):
        text = "aws iam create-role \\\n  --role-name r \\\n  --assume-role-policy-document '{}'"
        cmds = check_cli.extract_commands(text, "bash")
        self.assertEqual(len(cmds), 1)
        self.assertEqual(cmds[0].line, 1)
        self.assertEqual(problems(text), [])

    def test_heredoc_body_and_comments_skipped(self):
        text = "\n".join(
            [
                "cat > policy.json <<'ROLECRAFT_EOF'",
                "aws iam delete-role --bogus",
                "ROLECRAFT_EOF",
                "# aws iam delete-role --bogus",
                "aws iam get-role --role-name r # aws trailing comment",
            ]
        )
        self.assertEqual(count(text), 1)
        self.assertEqual(problems(text), [])

    def test_single_quoted_dollar_is_literal(self):
        cmd = check_cli.extract_commands("aws iam get-role --role-name '$x'", "bash")[0]
        self.assertFalse(cmd.words[-1].opaque)
        self.assertEqual(cmd.words[-1].value, "$x")


class PowerShellExtraction(unittest.TestCase):
    def test_assignment_if_backtick_and_here_string(self):
        text = "\n".join(
            [
                "[System.IO.File]::WriteAllText((Join-Path $PWD.ProviderPath 'p.json'), @'",
                "aws iam delete-role --bogus",
                "'@)",
                "$Arn = aws iam get-role --role-name $RoleName --query Role.Arn --output text --no-cli-pager",
                "if (aws iam get-role --role-name 'it''s') { }",
                "aws iam create-role `",
                "  --role-name $RoleName --assume-role-policy-document file://t.json | Out-Null",
                "# aws iam delete-role --bogus",
                'throw "aws failed: create-role"',
            ]
        )
        cmds = check_cli.extract_commands(text, "ps")
        self.assertEqual([c.line for c in cmds], [4, 5, 6])
        self.assertEqual(cmds[1].words[-1].value, "it's")
        self.assertTrue(cmds[0].words[4].opaque)
        self.assertEqual(problems(text, "ps"), [])


class ModelChecks(unittest.TestCase):
    def test_unknown_flag(self):
        self.assertEqual(problems("aws iam get-role --role-name r --bogus x"), ["1: iam get-role: unknown flag --bogus"])

    def test_missing_required(self):
        self.assertEqual(problems("aws iam attach-role-policy --role-name r"), ["1: iam attach-role-policy: missing required --policy-arn"])

    def test_unknown_operation_and_service(self):
        self.assertEqual(problems("aws iam make-role --role-name r"), ["1: unknown operation 'iam make-role'"])
        self.assertEqual(problems("aws nosuchsvc list-things"), ["1: unknown service 'nosuchsvc'"])

    def test_missing_value(self):
        self.assertEqual(
            problems("aws iam get-role --role-name --output text"),
            ["1: iam get-role --role-name: needs a value"],
        )

    def test_global_needs_value_and_output_enum(self):
        self.assertEqual(problems("aws iam get-role --role-name r --query"), ["1: iam get-role: --query needs a value"])
        self.assertEqual(problems("aws iam get-role --role-name r --output xml")[0][:30], "1: iam get-role: --output: 'xm")

    def test_shorthand_structure_and_enum(self):
        base = "aws eks associate-access-policy --cluster-name c --principal-arn a --policy-arn p --access-scope "
        self.assertEqual(problems(base + "type=cluster"), [])
        self.assertEqual(problems(base + "'{\"type\":\"namespace\",\"namespaces\":[\"x\"]}'"), [])
        self.assertIn("is not one of", problems(base + "type=clusterwide")[0])
        self.assertIn("unknown shorthand key 'kind'", problems(base + "kind=cluster")[0])
        self.assertIn("invalid JSON", problems(base + "'{type: cluster}'")[0])

    def test_integer_and_boolean(self):
        self.assertEqual(problems("aws iam create-role --role-name r --assume-role-policy-document x --max-session-duration 3600"), [])
        self.assertIn(
            "is not an integer",
            problems("aws iam create-role --role-name r --assume-role-policy-document x --max-session-duration 1h")[0],
        )
        self.assertEqual(problems("aws iam update-account-password-policy --require-symbols --no-allow-users-to-change-password"), [])
        self.assertIn(
            "boolean flag takes no value",
            problems("aws iam update-account-password-policy --require-symbols true")[0],
        )
        self.assertIn("only valid for boolean", problems("aws iam get-role --no-role-name")[0])

    def test_list_values_and_opaque_values(self):
        self.assertEqual(problems("aws iam create-open-id-connect-provider --url https://x --client-id-list a b"), [])
        self.assertEqual(problems('aws iam create-role --role-name "$R" --assume-role-policy-document "$(cat t.json)"'), [])

    def test_extra_value_is_rejected(self):
        self.assertIn("takes one value", problems("aws iam get-role --role-name a b")[0])
        self.assertIn("unexpected argument", problems("aws iam get-role stray --role-name a")[0])

    def test_waiter(self):
        self.assertEqual(problems("aws iam wait role-exists --role-name r"), [])
        self.assertEqual(problems("aws iam wait role-gone --role-name r"), ["1: unknown waiter 'iam wait role-gone'"])
        self.assertEqual(problems("aws iam wait role-exists"), ["1: iam wait role-exists: missing required --role-name"])

    def test_file_reference_must_exist(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "trust.json"), "w").close()
            ok = "aws iam create-role --role-name r --assume-role-policy-document file://trust.json"
            self.assertEqual(problems(ok, base_dir=d), [])
            self.assertIn("does not exist", problems(ok.replace("trust", "nope"), base_dir=d)[0])

    def test_cloudformation_deploy_allow_list(self):
        ok = "aws cloudformation deploy --template-file t.yaml --stack-name s --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --region 'eu-west-1'"
        self.assertEqual(problems(ok), [])
        self.assertIn("unknown flag --bogus", problems(ok + " --bogus")[0])
        self.assertIn("missing required --stack-name", problems("aws cloudformation deploy --template-file t.yaml")[0])
        self.assertIn("is not one of", problems("aws cloudformation deploy --template-file t --stack-name s --capabilities IAM")[0])


class SourceKinds(unittest.TestCase):
    def test_markdown_fences_and_inline_spans(self):
        md = "\n".join(
            [
                "Run `aws sts get-caller-identity --output text` first; `aws iam attach-group-policy` is just a name.",
                "```sh",
                "aws iam get-role --role-name r",
                "```",
                "```json",
                "aws iam not-checked",
                "```",
            ]
        )
        self.assertEqual([c.line for c in check_cli.markdown_commands(md)], [1, 3])

    def test_yaml_comment_commands(self):
        y = "\n".join(
            [
                "# Deploy: aws cloudformation deploy --template-file t --stack-name s",
                "# If it fails, delete the stack (aws cloudformation delete-stack --stack-name s) first.",
                "# aws iam attach-group-policy --group-name 'g' --policy-arn 'arn:x'",
                "Resources: {}",
            ]
        )
        self.assertEqual(len(check_cli.comment_commands(y)), 3)


if __name__ == "__main__":
    unittest.main()
