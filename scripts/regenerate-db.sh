#!/bin/bash

set -euo pipefail

function init_system() {
    pacman-key --init
    pacman-key --populate
    pacman -Syu --noconfirm
    pacman -S --noconfirm --needed wget git jq
    pacman -Scc --noconfirm
}

function add_repo() {
    mkdir -p /build/assets

    cd /build/assets || exit 1

    mapfile -t urls < <(curl --silent https://api.github.com/repos/bryan2333/my-arch-repo/releases/latest | jq -r '.assets[] | select(.browser_download_url) | .browser_download_url')

    for url in "${urls[@]}"
    do
        wget "${url}" || echo "Failed to download $(basename "${url}")"
    done 

    rm -rf remote-repo*

    find . -name "*.pkg.tar.*" -exec repo-add -n remote-repo.db.tar.xz {} \;

    find . -name "*.old" -exec rm -rf {} \;

    find . -name "*.pkg.tar.*" -exec rm -rf {} \;
}

function upload_assets() {
    cd /build || exit 1

    wget https://github.com/tcnksm/ghr/releases/download/v0.17.0/ghr_v0.17.0_linux_amd64.tar.gz -O ghr.tar.gz

    tar -xvf ghr.tar.gz

    mv -i ghr*_linux_amd64/ghr ./

    chmod +x ./ghr

    repo_owner="$(echo "${REPO_INFO}" | cut -d "/" -f 1)"
    repo_name="$(echo "${REPO_INFO}" | cut -d "/" -f 2)"

    ./ghr --replace -u "${repo_owner}" -r "${repo_name}" -t "${GITHUB_TOKEN}" packages assets
}

function main() {
    init_system
    add_repo
    upload_assets
}

main "$@"
