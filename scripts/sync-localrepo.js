#!/usr/bin/env zx

import fs from "fs";

const LOCAL_REPO_DIR = "/srv/http/localrepo";
const LOCAL_REPO_DATABASE = `${LOCAL_REPO_DIR}/localrepo.db.tar.xz`;
const REMOTE_REPO_DIR =
    "https://github.com/Bryan2333/my-arch-repo/releases/download/packages";
const REMOTE_REPO_DATABASE = `${REMOTE_REPO_DIR}/remote-repo.db.tar.xz`;

/**
 * @typedef {Object} Package
 * @property {String} name
 * @property {String} filename
 * @property {String[]} depends
 */

/**
 *
 * @param {String} alpm_database
 * @returns {Map<String, Package>}
 */
function getPackagesFromDB(alpm_database) {
    const tmp_dir = $.sync`mktemp -d`.stdout.trim();

    $.sync`bsdtar -xf ${alpm_database} -C ${tmp_dir}`;

    const dirs = fs.readdirSync(tmp_dir);

    const packages_list = new Map();

    /**
     *
     * @param {String} text
     * @param {String} key
     * @returns {String}
     */
    const extractValue = (text, key) => {
        const regex = new RegExp(`%${key}%\\s*([\\s\\S]*?)(?=%\\w+%|$)`);
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    for (const dir of dirs) {
        const text = fs.readFileSync(`${tmp_dir}/${dir}/desc`, "utf-8");

        const filename = extractValue(text, "FILENAME");
        const name = extractValue(text, "NAME");
        const dependsRaw = extractValue(text, "DEPENDS");

        const depends = dependsRaw
            ?.split("\n")
            .map((dep) => dep.trim())
            .filter((dep) => dep);

        packages_list.set(name, {
            name,
            filename,
            depends,
        });
    }

    fs.rmSync(tmp_dir, { recursive: true });

    return packages_list;
}

/**
 *
 * @returns {Set<Package>}
 */
function packageToDownload(options) {
    const tmp_dir = $.sync`mktemp -d`.stdout.trim();

    const packages_to_download = new Set();

    $.sync`curl --silent --retry 3 -O -L --output-dir ${tmp_dir} ${REMOTE_REPO_DATABASE}`;

    const local_packages = getPackagesFromDB(LOCAL_REPO_DATABASE);
    const remote_packages = getPackagesFromDB(
        `${tmp_dir}/remote-repo.db.tar.xz`
    );

    for (const [remotePkgName, remotePkg] of remote_packages) {
        const localPkg = local_packages.get(remotePkgName);

        if (!localPkg) {
            if (options.update_only !== true) {
                packages_to_download.add(remotePkg);
            }
        } else {
            const isNewer =
                $.sync`vercmp ${localPkg.filename} ${remotePkg.filename}`.stdout.trim() ===
                "-1";

            if (isNewer) {
                packages_to_download.add(remotePkg);
            }
        }
    }

    remote_packages.forEach((remotePkg, remotePkgName) => {
        packages_to_download.forEach((pkg) => {
            if (pkg.depends?.includes(remotePkgName)) {
                packages_to_download.add(remotePkg);
            }
        });
    });

    console.log("============ 需要下载的软件包 =================");
    packages_to_download.forEach((pkg) => {
        console.log(pkg.filename);
    });
    console.log("===============================================");

    fs.rmSync(tmp_dir, { recursive: true });

    return packages_to_download;
}

/**
 *
 * @param {Set<Package>} packages_to_download
 */
function downloadPackage(packages_to_download) {
    for (const pkg of packages_to_download) {
        const filename = pkg.filename;
        console.log(`正在下载${filename}`);
        $.sync`curl --retry 3 -O -L --output-dir ${LOCAL_REPO_DIR} ${REMOTE_REPO_DIR}/${filename}`;
    }
}

function main() {
    const options = {
        update_only: false,
        dryrun: false,
    };

    process.argv.slice(2).forEach((arg) => {
        if (arg === "--update-only") {
            options.update_only = true;
        } else if (arg === "--dryrun") {
            options.dryrun = true;
        }
    });

    const pkgs = packageToDownload(options);

    if (options.dryrun === false) {
        downloadPackage(pkgs);
    }
}

main();
