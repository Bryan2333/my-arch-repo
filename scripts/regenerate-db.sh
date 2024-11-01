#!/bin/bash

cat /proc/cpuinfo

package_to_build="$1"
use_patch="$2"

function builder_do() {
    sudo -u builduser bash -c "$@"
}

function init_system() {
    pacman-key --init
    pacman-key --populate
    pacman -Syu --noconfirm
    pacman -S --noconfirm --needed wget git jq
    pacman -Scc --noconfirm
}

function add_repo() {
    cd /build || exit 1

    urls=$(curl https://api.github.com/repos/bryan2333/my-arch-repo/releases/latest | jq -r '.assets[] | select(.browser_download_url) | .browser_download_url')

    for url in ${urls[@]}
    do
        wget $url
    done 

    rm -rf remote-repo*

    repo-add -n remote-repo.db.tar.xz *.pkg.tar.*
}

init_system
add_repo
