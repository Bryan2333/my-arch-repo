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

function create_normal_user() {
    useradd -m -s /bin/bash builduser

    chown builduser:builduser -R /build

    passwd -d builduser

    printf 'builduser ALL=(ALL) ALL\n' | tee -a /etc/sudoers

    git config --global --add safe.directory /build
}

function install_paru() {
    cd /build || exit 1

    wget -O - https://github.com/Morganamilo/paru/releases/download/v2.0.4/paru-v2.0.4-x86_64.tar.zst > paru.tar.zst

    tar -xf paru.tar.zst paru paru.conf  && mv paru /usr/bin/paru && mv paru.conf /etc/paru.conf

    rm -rf paru*

    mv /build/makepkg-custom.conf /etc/makepkg.conf.d/custom.conf
}

function build_package() {
    cd /build || exit 1

    package_url=$(jq -r ".[] | select(.name == \"$package_to_build\") | .url" aur-packages.json)

    if ! [[ -z "${package_url}" ]]
    then
        git clone "$package_url"
    else
        git clone https://aur.archlinux.org/"$package_to_build".git
    fi

    chown builduser:builduser -R "$package_to_build"

    cd "$package_to_build" || exit 1

    if [[ "true" == "$use_patch" ]]
    then
        if ls /build/patches | grep -qE "$package_to_build"
        then
            echo "Applying the patch"
            echo "===================================== Here is the patch content ====================================="
            cat "/build/patches/$package_to_build.patch"
            echo "====================================================================================================="
            builder_do "patch -Np1 < /build/patches/$package_to_build.patch"
        fi
    fi

    builder_do "env HOME=/home/builduser paru -B . --noconfirm"

    find ./ -name "*.pkg.tar.*" -exec mv {} /build/ \;
    find /home/builduser -name "*.pkg.tar.*" -exec mv {} /build/ \;
}

function add_repo() {
    cd /build || exit 1

    wget https://github.com/Bryan2333/my-arch-repo/releases/download/packages/remote-repo.db.tar.xz

    repo-add -n remote-repo.db.tar.xz *.pkg.tar.*
}

init_system
create_normal_user
install_paru
build_package
add_repo
