import fs from "fs";
import { $ } from "zx";

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
 * @typedef {Object} Options
 * @property {Boolean} update_only
 * @property {Boolean} dryrun
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

    /**
     * @type {Map<String, Package>}
     */
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
 * @param {Options} options
 * @returns {Set<Package>}
 */
function packageToDownload(options) {
    const tmp_dir = $.sync`mktemp -d`.stdout.trim();

    /**
     * @type {Set<Package>}
     */
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

        if (localPkg && localPkg.depends) {
            for (const dependency of localPkg.depends) {
                const remoteDependency = remote_packages.get(dependency);
                if (!local_packages.has(dependency) && remoteDependency) {
                    packages_to_download.add(remoteDependency);
                }
            }
        }
    }

    for (const [remotePkgName, remotePkg] of remote_packages) {
        for (const pkg of packages_to_download) {
            if (pkg.depends?.includes(remotePkgName)) {
                packages_to_download.add(remotePkg);
            }
        }
    }

    console.log("============ 需要下载的软件包 =================");
    for (const pkg of packages_to_download) {
        console.log(pkg.filename);
    }
    console.log("===============================================");

    fs.rmSync(tmp_dir, { recursive: true });

    return packages_to_download;
}

/**
 *
 * @param {Set<Package>} packages_to_download
 */
async function downloadPackage(packages_to_download) {
    for (const pkg of packages_to_download) {
        const filename = pkg.filename;
        console.log(`正在下载${filename}`);
        await $`curl --retry 3 -O -L --output-dir ${LOCAL_REPO_DIR} ${REMOTE_REPO_DIR}/${filename}`;
    }
}

async function main() {
    const options = {
        update_only: false,
        dryrun: false,
    };

    for (const arg of process.argv.slice(2)) {
        if (arg === "--update-only") {
            options.update_only = true;
        } else if (arg === "--dryrun") {
            options.dryrun = true;
        }
    }

    const pkgs = packageToDownload(options);

    if (options.dryrun === false) {
        await downloadPackage(pkgs);
    }
}

main();
