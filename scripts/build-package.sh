#!/bin/bash

set -euo pipefail

cat /proc/cpuinfo

package_to_build="${1:-}"

BUILD_DIR="/build"
ASSETS_DIR="${BUILD_DIR}/assets"
PKG_DIR="${BUILD_DIR}/packages"

function builder_do() {
    sudo -u builduser bash -c "$*"
}

function init_system() {
    pacman-key --init
    pacman-key --populate
    pacman -Syu --noconfirm
    pacman -S --noconfirm --needed base-devel wget git jq
    pacman -Scc --noconfirm
    mv "${BUILD_DIR}/makepkg-custom.conf" /etc/makepkg.conf.d/custom.conf
    mkdir -p "${ASSETS_DIR}"
}

function create_normal_user() {
    useradd -m -s /bin/bash builduser

    chown builduser:builduser -R "${BUILD_DIR}"

    passwd -d builduser

    printf 'builduser ALL=(ALL) ALL\n' | tee -a /etc/sudoers

    git config --global --add safe.directory "${BUILD_DIR}"
}

function build_package() {
    local _pkg="$1"

    echo "Building package: ${_pkg}"

    cd "${PKG_DIR}" || exit 1

    local _pkgbuild_dir

    _pkgbuild_dir="$(find . -type d -name "${_pkg}" -printf "%f\n" || true)"

    if [[ -z "${_pkgbuild_dir}" ]]
    then
        git clone https://aur.archlinux.org/"${_pkg}".git
    fi

    chown builduser:builduser -R "${_pkg}"

    cd "${_pkg}" || exit 1

    (
        if grep -qE "validpgpkeys" PKGBUILD
        then
            source PKGBUILD

            for key in "${validpgpkeys[@]}"
            do
                builder_do gpg --recv-keys "${key}" || echo "Failed to import key: ${key}"
            done
        fi
    )

    local _makepkg_args=("--syncdeps" "--clean" "--noconfirm")

    if [[ "${_pkg}" != "${package_to_build}" ]]
    then
        _makepkg_args+=("--install")
    fi

    builder_do makepkg "${_makepkg_args[*]}"

    find . -name "*.pkg.tar.*" -exec mv {} "${ASSETS_DIR}"/ \;
}

function process_deps() {
    cd "${PKG_DIR}/${package_to_build}" || exit 1

    if [[ -f "aur_deps" ]]
    then
        local -r PKG_REGEX='^([a-zA-Z0-9_.+-]+)-([0-9a-zA-Z_.+-]+)-([0-9]+)-([a-zA-Z0-9_.+-]+)\.pkg\.tar\.(zst|xz|gz)$'

        declare -A remote_packages_map
        mapfile -t remote_packages_url < <(curl --silent https://api.github.com/repos/bryan2333/my-arch-repo/releases/latest | jq -r '.assets | sort_by(.created_at) | reverse | .[].browser_download_url')

        for url in "${remote_packages_url[@]}"
        do
            package_file="$(basename "${url}")"
            remote_packages_map["${package_file}"]="${url}"
        done

        while IFS= read -r dep
        do
            for package_file in "${!remote_packages_map[@]}"
            do
                if [[ "${package_file}" =~ ${PKG_REGEX} ]]
                then
                    if [[ "${BASH_REMATCH[1]}" != "${dep}" ]]
                    then
                        continue
                    fi

                    local pkgver_in_remote="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
                    local pkgver_in_aur

                    pkgver_in_aur="$(curl --silent https://aur.archlinux.org/rpc/v5/info?arg[]="${dep}" | jq -r '.results[].Version')"

                    if [[ "$(vercmp "$pkgver_in_remote" "$pkgver_in_aur")" -lt 0 ]]
                    then
                        echo "AUR package is newer than remote package"
                        build_package "${dep}"
                    else
                        remote_url="${remote_packages_map["${package_file}"]}"
                        { 
                            wget "${remote_url}" 
                            pacman -U --noconfirm "${package_file}"
                            rm -rf "${package_file}" 
                        } || echo "Failed to download ${package_file} from remote repo"
                    fi

                    break
                fi
            done 
        done < aur_deps
    fi
}

function add_repo() {
    cd "${ASSETS_DIR}" || exit 1
     
    mapfile -t urls < <(curl --silent https://api.github.com/repos/bryan2333/my-arch-repo/releases/latest | jq -r '.assets[] | select(.browser_download_url) | .browser_download_url')

    for url in "${urls[@]}"
    do
        if [[ "${url}" =~ "remote-repo" ]]
        then
            wget "${url}" || echo "Failed to download $(basename "${url}")"
        fi
    done

    find . -name "*.pkg.tar.*" -exec repo-add -n remote-repo.db.tar.xz {} \;

    find . -name "*.old" -exec rm -rf {} \;
}

function upload_assets() {
    cd "${BUILD_DIR}" || exit 1

    wget https://github.com/tcnksm/ghr/releases/download/v0.17.0/ghr_v0.17.0_linux_amd64.tar.gz -O ghr.tar.gz 

    tar -xvf ghr.tar.gz

    mv -i ghr*_linux_amd64/ghr ./

    chmod +x ./ghr

    repo_owner="$(echo "${REPO_INFO}" | cut -d "/" -f 1)"
    repo_name="$(echo "${REPO_INFO}" | cut -d "/" -f 2)"

    ./ghr --replace -u "${repo_owner}" -r "${repo_name}" -t "${GITHUB_TOKEN}" packages "${ASSETS_DIR}"
}

function main() {
    init_system

    create_normal_user

    process_deps

    build_package "$package_to_build"

    add_repo

    upload_assets
}

main "$@"
