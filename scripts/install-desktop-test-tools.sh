#!/usr/bin/env bash
set -euo pipefail
tools_dir="$RUNNER_TEMP/voltius-zellij"
mkdir -p "$tools_dir/current" "$tools_dir/compat"
curl --fail --location 'https://github.com/zellij-org/zellij/releases/download/v0.45.1/zellij-no-web-x86_64-unknown-linux-musl.tar.gz' -o "$tools_dir/current/tool.tar.gz"
printf '%s  %s\n' d7bda1e18c30a688833ae7627f1d6a253bbba5349a4bc48e4f0ec008aaf75ed1 "$tools_dir/current/tool.tar.gz" | sha256sum --check -
curl --fail --location 'https://github.com/zellij-org/zellij/releases/download/v0.43.1/zellij-no-web-x86_64-unknown-linux-musl.tar.gz' -o "$tools_dir/compat/tool.tar.gz"
printf '%s  %s\n' bac0728945e8f5a28f2647e2b9b0cfe4591d71abfe227336b1318937241f071d "$tools_dir/compat/tool.tar.gz" | sha256sum --check -
tar -xzf "$tools_dir/current/tool.tar.gz" -C "$tools_dir/current"
tar -xzf "$tools_dir/compat/tool.tar.gz" -C "$tools_dir/compat"
echo "VOLTIUS_TEST_ZELLIJ=$tools_dir/current/zellij" >> "$GITHUB_ENV"
echo "VOLTIUS_TEST_ZELLIJ_COMPAT=$tools_dir/compat/zellij" >> "$GITHUB_ENV"
"$tools_dir/current/zellij" --version
"$tools_dir/compat/zellij" --version
