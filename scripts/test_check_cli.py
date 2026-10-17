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


def extraction(text: str, dialect: str = "bash") -> list[str]:
    return [f"{line}: {msg}" for line, msg in check_cli.extract(text, dialect)[1]]


def all_problems(text: str, dialect: str = "bash") -> list[str]:
    return extraction(text, dialect) + problems(text, dialect)


class BashExtraction(unittest.TestCase):
    def test_plain_and_substitution_and_if(self):
        text = "\n".join(
            [
                'aws iam get-role --role-name "$ROLE_NAME"',
                'ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)',
                "if ! aws iam get-role --role-name x >/dev/null 2>&1; then echo no; fi",
                'if [ -z "$e" ]; then aws iam create-open-id-connect-provider --url https://x --client-id-list sts.amazonaws.com; fi',
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
                "aws iam get-role --role-name r # trailing comment",
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
                "if (aws eks describe-cluster --name 'it''s') { }",
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
        self.assertEqual(
            problems("aws iam attach-role-policy --role-name r"), ["1: iam attach-role-policy: missing required --policy-arn"]
        )

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
        self.assertEqual(problems(base + '\'{"type":"namespace","namespaces":["x"]}\''), [])
        self.assertIn("is not one of", problems(base + "type=clusterwide")[0])
        self.assertIn("unknown shorthand key 'kind'", problems(base + "kind=cluster")[0])
        self.assertIn("invalid JSON", problems(base + "'{type: cluster}'")[0])

    def test_integer_and_boolean(self):
        self.assertEqual(
            problems("aws iam create-role --role-name r --assume-role-policy-document x --max-session-duration 3600"), []
        )
        self.assertIn(
            "is not an integer",
            problems("aws iam create-role --role-name r --assume-role-policy-document x --max-session-duration 1h")[0],
        )
        self.assertEqual(
            problems("aws iam update-account-password-policy --require-symbols --no-allow-users-to-change-password"), []
        )
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
            with open(os.path.join(d, "trust.json"), "w") as f:
                f.write("{}")
            ok = "aws iam create-role --role-name r --assume-role-policy-document file://trust.json"
            self.assertEqual(problems(ok, base_dir=d), [])
            self.assertIn("does not exist", problems(ok.replace("trust", "nope"), base_dir=d)[0])

    def test_cloudformation_deploy_allow_list(self):
        ok = "aws cloudformation deploy --template-file t.yaml --stack-name s --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --region 'eu-west-1'"
        self.assertEqual(problems(ok), [])
        self.assertIn("unknown flag --bogus", problems(ok + " --bogus")[0])
        self.assertIn("missing required --stack-name", problems("aws cloudformation deploy --template-file t.yaml")[0])
        self.assertIn(
            "is not one of", problems("aws cloudformation deploy --template-file t --stack-name s --capabilities IAM")[0]
        )


class NoSilentSkips(unittest.TestCase):
    """I1: anything that looks like an aws command must be checked, or reported."""

    def test_unrecognized_aws_line_is_reported(self):
        self.assertEqual(
            extraction('echo "aws iam get-role --role-name x"'),
            ['1: aws command not recognized by the checker: echo "aws iam get-role --role-name x"'],
        )

    def test_case_arm(self):
        self.assertIn("unknown flag --rolename", all_problems("case $x in\n  *a*) aws iam get-role --rolename x ;;\nesac")[0])

    def test_function_body(self):
        self.assertIn("unknown flag --rolename", all_problems("f() { aws iam get-role --rolename x; }")[0])
        self.assertIn("unknown flag --rolename", all_problems("function f {\n  aws iam get-role --rolename x\n}")[0])

    def test_backtick_substitution(self):
        self.assertIn("unknown flag --rolename", all_problems("X=`aws iam get-role --rolename x`")[0])
        self.assertIn("unknown flag --rolename", all_problems('X="`aws iam get-role --rolename x`"')[0])

    def test_env_and_var_prefix(self):
        self.assertIn("unknown flag --rolename", all_problems("env AWS_REGION=x aws iam get-role --rolename x")[0])
        self.assertIn("unknown flag --rolename", all_problems("AWS_REGION=x aws iam get-role --rolename x")[0])

    def test_heredoc_marker_inside_string_is_not_a_heredoc(self):
        self.assertIn("unknown flag --rolename", all_problems('echo "bash <<EOF"\naws iam get-role --rolename x')[0])
        self.assertIn("unknown flag --rolename", all_problems("echo 'a<<b'\naws iam get-role --rolename x")[0])

    def test_unterminated_heredoc_and_here_strings(self):
        self.assertIn("unterminated heredoc", extraction("cat <<EOF\naws iam get-role --rolename x")[0])
        self.assertIn("unterminated here-string", extraction("$s = @'\naws iam get-role --rolename x", "ps")[0])
        self.assertIn("unterminated here-string", extraction('$s = @"\naws iam get-role --rolename x', "ps")[0])

    def test_dash_heredoc_and_double_quoted_here_string_bodies_skipped(self):
        self.assertEqual(all_problems("cat <<-EOF\n\taws iam bogus\n\tEOF\naws iam get-role --role-name r"), [])
        self.assertEqual(all_problems('$s = @"\naws iam bogus\n"@\naws iam get-role --role-name r', "ps"), [])

    def test_heredoc_fed_to_a_shell_is_checked(self):
        text = "bash <<'EOF'\nset -e\naws iam get-role --rolename x\nEOF\ncat <<EOF\naws iam bogus\nEOF"
        self.assertEqual(all_problems(text)[0], "3: iam get-role: unknown flag --rolename")

    def test_unterminated_quote_or_substitution(self):
        self.assertIn("cannot tokenize", extraction('X="$(aws iam get-role\n --rolename x)"')[0])
        self.assertIn("cannot tokenize", extraction("X=$(aws iam get-role --role-name r")[0])

    def test_powershell_forms(self):
        for text in [
            "$x = (aws iam get-role --rolename x)",
            "$x = @(aws iam get-role --rolename x)",
            "$a | ForEach-Object { aws iam get-role --rolename $_ }",
            "& aws iam get-role --rolename x",
            "$null = aws iam get-role --rolename x",
            "try { aws iam get-role --rolename x } catch { }",
        ]:
            self.assertIn("unknown flag --rolename", all_problems(text, "ps")[0], text)
        self.assertEqual(all_problems("aws iam get-role --role-name x *>$null", "ps"), [])

    def test_markdown_unknown_fence_and_name_only_spans(self):
        cmds, probs = check_cli.markdown("```text\naws iam get-role --role-name r\n```")
        self.assertEqual(probs, [(1, "```text block contains aws commands but is not a shell/PowerShell fence")])
        cmds, _ = check_cli.markdown("delete it: `aws cloudformation delete-stack`.")
        self.assertFalse(cmds[0].name_only)
        self.assertIn("missing required --stack-name", check_cli.check_command(cmds[0], MODEL)[0])
        cmds, probs = check_cli.markdown("run the `aws iam attach-group-polcy` commands later")
        self.assertTrue(cmds[0].name_only)
        self.assertEqual(check_cli.check_command(cmds[0], MODEL), ["unknown operation 'iam attach-group-polcy'"])
        cmds, _ = check_cli.markdown("run the `aws iam attach-group-policy` command later")
        self.assertEqual(check_cli.check_command(cmds[0], MODEL), [])

    def test_markdown_powershell_fence_uses_powershell_rules(self):
        cmds, probs = check_cli.markdown(
            "```powershell\n$R = 'r'\naws iam get-role --role-name $R --no-cli-pager | Out-Null\n```"
        )
        self.assertEqual(probs, [])
        self.assertEqual([w.value for w in cmds[0].words][-2:], ["r", "--no-cli-pager"])

    def test_comment_command_not_recognized(self):
        self.assertIn("not recognized", check_cli.comments("# Run: aws iam get-role --role-name r")[1][0][1])


class ValueValidation(unittest.TestCase):
    """I5 / M5: values are validated like the CLI does (botocore ParamValidator)."""

    def test_min_value_and_min_length(self):
        p = problems("aws iam create-role --role-name r --assume-role-policy-document x --max-session-duration 100")
        self.assertEqual(
            p, ["1: iam create-role: botocore: Invalid value for parameter MaxSessionDuration, value: 100, valid min value: 3600"]
        )
        self.assertIn("valid min length: 1", problems("aws iam get-role --role-name ''")[0])

    def test_max_length_and_pattern(self):
        self.assertIn("longer than 64", problems("aws iam get-role --role-name " + "r" * 65)[0])
        self.assertIn("does not match the pattern", problems("aws iam get-role --role-name 'a b'")[0])

    def test_literal_variables_are_substituted(self):
        ok = "ROLE_NAME='r'\naws iam create-policy --policy-name \"${ROLE_NAME}-policy\" --policy-document x"
        self.assertEqual(problems(ok), [])
        bad = "ROLE_NAME='a b'\naws iam get-role --role-name \"$ROLE_NAME\""
        self.assertIn("does not match the pattern", problems(bad)[0])
        self.assertIn("valid min length: 1", problems("ROLE_NAME=''\naws iam get-role --role-name \"$ROLE_NAME\"")[0])
        ps_bad = "$RoleName = 'a b'\naws iam get-role --role-name $RoleName"
        self.assertIn("does not match the pattern", problems(ps_bad, "ps")[0])
        # Reassigned from a command: dynamic again (placeholder), not the old literal.
        self.assertEqual(problems("R='a b'\nR=$(echo r)\naws iam get-role --role-name \"$R\""), [])

    def test_flag_equals_value(self):
        self.assertEqual(problems("aws iam get-role --role-name=r --output=text"), [])
        self.assertIn("unknown flag --rolename", problems("aws iam get-role --rolename=r")[0])

    def test_shorthand_nested_list_and_comma_list(self):
        base = "aws eks associate-access-policy --cluster-name c --principal-arn a --policy-arn p --access-scope "
        self.assertEqual(problems(base + "type=namespace,namespaces=[a,b]"), [])
        self.assertEqual(problems("aws iam create-open-id-connect-provider --url https://x --client-id-list a,b"), [])

    def test_list_of_structures(self):
        base = "aws iam create-role --role-name r --assume-role-policy-document x --tags "
        self.assertEqual(problems(base + "Key=a,Value=b Key=c,Value=d"), [])
        self.assertIn('Missing required parameter in Tags[1]: "Value"', problems(base + "Key=a,Value=b Key=c")[0])

    def test_duplicate_globals(self):
        self.assertIn("--region given twice", problems("aws --region x iam get-role --role-name r --region y")[0])
        self.assertIn("--region given twice", problems("aws --region x --region y iam get-role --role-name r")[0])

    def test_file_contents_are_validated(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "p.json"), "w") as f:
                f.write("")
            p = problems("aws iam create-policy --policy-name n --policy-document file://p.json", base_dir=d)
            self.assertIn("PolicyDocument", p[0])


class SourceKinds(unittest.TestCase):
    def test_markdown_fences_and_inline_spans(self):
        md = "\n".join(
            [
                "Run `aws sts get-caller-identity --output text` first; the `aws iam attach-group-policy` commands are named.",
                "```sh",
                "aws iam get-role --role-name r",
                "```",
                "```json",
                "aws iam not-checked",
                "```",
            ]
        )
        self.assertEqual([(c.line, c.name_only) for c in check_cli.markdown(md)[0]], [(1, False), (1, True), (3, False)])

    def test_yaml_comment_commands(self):
        y = "\n".join(
            [
                "# Deploy: aws cloudformation deploy --template-file t --stack-name s",
                "# If it fails, delete the stack (aws cloudformation delete-stack --stack-name s) first.",
                "# aws iam attach-group-policy --group-name 'g' --policy-arn 'arn:x'",
                "Resources: {}",
            ]
        )
        self.assertEqual(len(check_cli.comments(y)[0]), 3)


if __name__ == "__main__":
    unittest.main()
