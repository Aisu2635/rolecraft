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
        self.assertIn(
            "unknown flag --rolename", all_problems("x=a\ncase $x in\n  *a*) aws iam get-role --rolename x ;;\nesac")[0]
        )

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
            "$a = @(1); $a | ForEach-Object { aws iam get-role --rolename $_ }",
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

    def test_flag_equals_dynamic_value(self):
        # --flag="$DYNAMIC" is still a flag (with a placeholder value), in bash and PowerShell.
        self.assertEqual(problems('A=$(echo x)\naws iam attach-role-policy --role-name=r --policy-arn="$A"'), [])
        ps = '$A = Get-Date\naws iam attach-role-policy "--role-name=r" "--policy-arn=$A"'
        self.assertEqual(problems(ps, "ps"), [])
        # Literal variables are still substituted and validated in the --flag=value form.
        self.assertIn("does not match the pattern", problems("R='a b'\naws iam get-role --role-name=\"$R\"")[0])
        self.assertIn("does not match the pattern", problems("$R = 'a b'\naws iam get-role \"--role-name=$R\"", "ps")[0])

    def test_value_starting_with_dash_needs_flag_equals_form(self):
        # argparse reads a separate '-x' word as an option: the CLI fails before calling AWS.
        self.assertIn("starts with '-'", problems("aws iam get-role --role-name '-x'")[0])
        self.assertIn("starts with '-'", problems("R='-x'\naws iam get-role --role-name \"$R\"")[0])
        self.assertIn("starts with '-'", problems("$R = '-x'\naws iam get-role --role-name $R", "ps")[0])
        self.assertEqual(problems("R='-x'\naws iam get-role --role-name=\"$R\""), [])
        self.assertEqual(problems("$R = '-x'\naws iam get-role \"--role-name=$R\"", "ps"), [])

    def test_version(self):
        self.assertEqual(problems("aws --version"), [])
        self.assertIn("unknown global flag --version", problems("aws --version iam get-role --role-name r")[0])

    def test_configure_get(self):
        self.assertEqual(problems("aws configure get region"), [])
        self.assertEqual(problems("aws configure get region --profile p"), [])
        self.assertIn("aws configure get", problems("aws configure get")[0])
        self.assertIn("aws configure get", problems("aws configure get colour")[0])
        self.assertIn("aws configure", problems("aws configure set region x")[0])

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


class UndefinedVariables(unittest.TestCase):
    """Re-review I1: a reference to a never-assigned variable is a problem (typo'd names fail)."""

    def test_powershell_typos_fail(self):
        base = "$RoleName = 'r'\n"
        self.assertEqual(
            extraction(base + "aws iam get-role --role-name $RoleNam --no-cli-pager", "ps"), ["2: $RoleNam is never assigned"]
        )
        self.assertEqual(
            extraction(base + 'aws iam create-policy --policy-name "${RoleNme}-policy" --policy-document x', "ps"),
            ["2: $RoleNme is never assigned"],
        )

    def test_bash_typos_fail(self):
        base = "ROLE_NAME='r'\n"
        self.assertEqual(extraction(base + 'aws iam get-role --role-name "$ROLE_NAM"'), ["2: $ROLE_NAM is never assigned"])
        self.assertEqual(
            extraction(base + 'aws iam create-policy --policy-name "${ROLE_NME}-policy" --policy-document x'),
            ["2: $ROLE_NME is never assigned"],
        )
        self.assertEqual(extraction(base + 'echo "Created $ROLE_NAM."'), ["2: $ROLE_NAM is never assigned"])

    def test_powershell_assignment_forms_and_automatic_variables(self):
        text = "\n".join(
            [
                "$ErrorActionPreference = 'Stop'",
                "$Arn = aws iam get-role --role-name r --query Role.Arn --output text --no-cli-pager",
                "if ($LASTEXITCODE -ne 0) { throw 'x' }",
                "foreach ($Name in @('a')) { Write-Output $Name }",
                "@('a') | ForEach-Object { Write-Output $_ $PSItem }",
                "$script:Count = 1",
                "[string]$Typed = 'x'",
                "Write-Output $Arn $Count $Typed $env:AWS_REGION $PWD.ProviderPath $null $true $HOME $PSScriptRoot",
                "Write-Output '$NotAVariable' \"`$Escaped\" $ARN",
            ]
        )
        self.assertEqual(extraction(text, "ps"), [])

    def test_bash_assignment_forms_and_special_variables(self):
        text = "\n".join(
            [
                "set -euo pipefail",
                "ARN=$(aws iam get-role --role-name r --query Role.Arn --output text)",
                "export REGION=us-east-1",
                "readonly A=1 B",
                'f() { local L=1; echo "$L $1 $# $@ $?"; }',
                "read -r ANSWER",
                'for ITEM in a b; do echo "$ITEM"; done',
                "if true; then COND=x; fi",
                'echo "$ARN $REGION $A $B $ANSWER $COND $HOME $PWD $PATH $AWS_REGION ${UNSET_OK:-default}"',
                "echo '$NOT_A_VAR' \\$ESCAPED",
            ]
        )
        self.assertEqual(extraction(text), [])

    def test_shell_heredoc_body_sees_outer_names(self):
        self.assertEqual(extraction("R='r'\nbash <<EOF\necho \"$R $NOPE\"\nEOF"), ["3: $NOPE is never assigned"])

    def test_spans_and_comments_are_not_scripts(self):
        self.assertEqual(check_cli.markdown('Run `aws iam get-role --role-name "$ROLE_NAME"` later.')[1], [])


class StaleLiterals(unittest.TestCase):
    """Re-review M2: any second, conditional, indented or scoped assignment makes the variable dynamic."""

    def last_word(self, text: str, dialect: str = "bash") -> check_cli.Word:
        return check_cli.extract_commands(text, dialect)[-1].words[-1]

    def test_conditional_reassignment_is_dynamic(self):
        w = self.last_word("ROLE_NAME='ok'\nif true; then ROLE_NAME='bad name'; fi\naws iam get-role --role-name \"$ROLE_NAME\"")
        self.assertTrue(w.opaque)
        w = self.last_word("if true; then\n  ROLE_NAME='bad name'\nfi\naws iam get-role --role-name \"$ROLE_NAME\"")
        self.assertTrue(w.opaque)

    def test_export_readonly_local_are_dynamic(self):
        for form in ("export ROLE_NAME='r'", "readonly ROLE_NAME='r'", "declare ROLE_NAME='r'"):
            self.assertTrue(self.last_word(form + '\naws iam get-role --role-name "$ROLE_NAME"').opaque, form)

    def test_powershell_scope_prefix_is_dynamic(self):
        w = self.last_word("$RoleName = 'r'\n$script:RoleName = 'bad name'\naws iam get-role --role-name $RoleName", "ps")
        self.assertTrue(w.opaque)

    def test_single_top_level_literal_is_substituted(self):
        w = self.last_word("ROLE_NAME='r'\naws iam get-role --role-name \"$ROLE_NAME\"")
        self.assertEqual((w.value, w.opaque), ("r", False))


class AwsForms(unittest.TestCase):
    """Re-review M1: aws.exe, quoted aws, heredocs piped to a shell, README prose."""

    def test_aws_exe_and_quoted(self):
        self.assertIn("unknown flag --rolename", all_problems("aws.exe iam get-role --rolename x", "ps")[0])
        self.assertIn("unknown flag --rolename", all_problems("& 'aws.exe' iam get-role --rolename x", "ps")[0])
        self.assertIn("unknown flag --rolename", all_problems("'aws' iam get-role --rolename x")[0])
        self.assertIn("unknown flag --rolename", all_problems('"aws" iam get-role --rolename x')[0])

    def test_aws_like_matches_exe_and_quotes(self):
        self.assertEqual(len(extraction('echo "aws.exe iam get-role --role-name x"')), 1)
        self.assertEqual(len(extraction("echo \"'aws' iam get-role\"")), 1)

    def test_heredoc_piped_to_shell_is_checked(self):
        for sh in ("bash", "sh", "/bin/bash -s"):
            text = f"cat <<'EOF' | {sh}\naws iam get-role --rolename x\nEOF"
            self.assertEqual(all_problems(text)[0], "2: iam get-role: unknown flag --rolename", sh)
        self.assertEqual(all_problems("cat <<'EOF' | jq .\naws iam bogus\nEOF"), [])

    def test_readme_prose_command_outside_code(self):
        _, probs = check_cli.markdown("Then run aws iam get-role --role-name x to see it.")
        self.assertEqual(len(probs), 1)
        self.assertIn("outside a code span", probs[0][1])
        self.assertEqual(check_cli.markdown("Then run `aws iam get-role --role-name x` to see it.")[1], [])


class UncompilablePatterns(unittest.TestCase):
    """Re-review M3: model patterns Python can't compile are counted, not silently ignored."""

    def test_counted(self):
        class Shape:
            type_name = "string"
            enum = None
            metadata = {"pattern": "\\p{L}+"}

        check_cli.UNCOMPILABLE.clear()
        self.assertEqual(check_cli.check_value("x", Shape(), "w"), [])
        self.assertEqual(check_cli.UNCOMPILABLE, {"\\p{L}+"})


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
