#!/bin/bash

set -eu

name=electron@_electronver@
flags_file="${XDG_CONFIG_HOME:-$HOME/.config}/${name}-flags.conf"
fallback_file="${XDG_CONFIG_HOME:-$HOME/.config}/electron-flags.conf"

lines=()
if [[ -f "${flags_file}" ]]; then
    mapfile -t lines < "${flags_file}"
elif [[ -f "${fallback_file}" ]]; then
    mapfile -t lines < "${fallback_file}"
fi

flags=()
for line in "${lines[@]}"; do
    if [[ ! "${line}" =~ ^[[:space:]]*#.* ]] && [[ -n "${line}" ]]; then
        flags+=("${line}")
    fi
done

: "${ELECTRON_IS_DEV:=0}"
export ELECTRON_IS_DEV
: "${ELECTRON_FORCE_IS_PACKAGED:=true}"
export ELECTRON_FORCE_IS_PACKAGED
export NODE_ENV=production

exec /usr/lib/${name}/electron /usr/lib/drawio-desktop/app.asar "${flags[@]}" "$@"
