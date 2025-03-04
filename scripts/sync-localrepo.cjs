#!/usr/bin/env node

const fs = require("fs");
const { $ } = require("zx");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");

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
 * @param {String} alpm_database
 * @returns {Map<String, Package>}
 */
function getPackagesFromDB(alpm_database) {
    const tmpDir = $.sync`mktemp -d`.stdout.trim();

    try {
        $.sync`bsdtar -xf ${alpm_database} -C ${tmpDir}`;
        const dirs = fs.readdirSync(tmpDir);

        /**
         * @type {Map<String, Package>}
         */
        const packages_list = new Map();

        /**
         * @param {string} text
         * @param {string} key
         * @returns {string}
         */
        const extractValue = (text, key) => {
            const regex = new RegExp(`%${key}%\\s*([\\s\\S]*?)(?=%\\w+%|$)`);
            const match = text.match(regex);
            return match ? match[1].trim() : null;
        };

        for (const dir of dirs) {
            const text = fs.readFileSync(`${tmpDir}/${dir}/desc`, "utf-8");
            const filename = extractValue(text, "FILENAME");
            const name = extractValue(text, "NAME");
            const dependsRaw = extractValue(text, "DEPENDS");
            const depends = dependsRaw
                ? dependsRaw
                      .split("\n")
                      .map((dep) => dep.trim())
                      .filter((dep) => dep)
                : [];
            packages_list.set(name, { name, filename, depends });
        }
        return packages_list;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * 递归收集软件包的依赖
 * @param {Package} pkg 软件包对象
 * @param {Map<String, Package>} remote_packages 远程软件包集合
 * @param {Map<String, Package>} local_packages 本地软件包集合
 * @param {Set<String>} collected 已收集的软件包名
 * @returns {Set<String>} 收集到的软件包名集合
 */
function collectDependencies(
    pkg,
    remote_packages,
    local_packages,
    collected = new Set()
) {
    if (collected.has(pkg.name)) return collected;
    collected.add(pkg.name);
    for (const dep of pkg.depends || []) {
        // 如果本地没有安装该依赖，且远程有此包，则收集
        if (!local_packages.has(dep)) {
            const depPkg = remote_packages.get(dep);
            if (depPkg) {
                collectDependencies(
                    depPkg,
                    remote_packages,
                    local_packages,
                    collected
                );
            }
        }
    }
    return collected;
}

/**
 * @param {{update_only: Boolean, dryrun: Boolean}} options
 * @returns {Map<String, Package>}
 */
function packageToDownload(options) {
    const tmpDir = $.sync`mktemp -d`.stdout.trim();

    try {
        $.sync`curl --silent --retry 3 -O -L --output-dir ${tmpDir} ${REMOTE_REPO_DATABASE}`;

        const local_packages = getPackagesFromDB(LOCAL_REPO_DATABASE);
        const remote_packages = getPackagesFromDB(
            `${tmpDir}/remote-repo.db.tar.xz`
        );

        /**
         * @type {Map<String, Package>}
         */
        const packages_to_download = new Map();

        for (const [remotePkgName, remotePkg] of remote_packages) {
            const localPkg = local_packages.get(remotePkgName);
            if (!localPkg) {
                if (!options.update_only) {
                    packages_to_download.set(remotePkgName, remotePkg);
                }
            } else {
                const isNewer =
                    $.sync`vercmp ${localPkg.filename} ${remotePkg.filename}`.stdout.trim() ===
                    "-1";
                if (isNewer) {
                    packages_to_download.set(remotePkgName, remotePkg);
                }
            }
        }

        for (const pkg of packages_to_download.values()) {
            const deps = collectDependencies(
                pkg,
                remote_packages,
                local_packages
            );
            for (const depName of deps) {
                if (!packages_to_download.has(depName)) {
                    const depPkg = remote_packages.get(depName);
                    if (depPkg) {
                        packages_to_download.set(depName, depPkg);
                    }
                }
            }
        }

        if (packages_to_download.size === 0) {
            console.log("没有需要更新的软件包");
        } else {
            console.log("============ 需要下载的软件包 =================");
            for (const pkg of packages_to_download.values()) {
                console.log(pkg.filename);
            }
            console.log("===============================================");
        }

        return packages_to_download;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * @param {Map<String, Package>} packages_to_download
 */
async function downloadPackage(packages_to_download) {
    for (const pkg of packages_to_download.values()) {
        console.log(`正在下载 ${pkg.filename}`);
        await $`curl --retry 3 -O -L --output-dir ${LOCAL_REPO_DIR} ${REMOTE_REPO_DIR}/${pkg.filename}`;
    }
}

async function main() {
    const argv = yargs(hideBin(process.argv))
        .usage("Usage: $0 [options]")
        .boolean("update-only")
        .alias("update-only", "u")
        .describe("update-only", "仅更新已安装的软件包")
        .boolean("dryrun")
        .alias("dryrun", "d")
        .describe("dryrun", "仅显示将要下载的软件包，不执行下载")
        .help("help", "显示帮助信息")
        .alias("help", "h")
        .version(false)
        .parse(process.argv, (err, _, output) => {
            if (output) {
                // 去除类型提示
                output = output.replace(/\[\w+\]/g, "");
                console.log(output);
            }
            if (err) {
                process.exit(1);
            }
        });

    const options = {
        update_only: argv["update-only"],
        dryrun: argv.dryrun,
        show_help: argv.help,
    };

    if (options.show_help) {
        return;
    }

    const pkgs = packageToDownload(options);

    if (!options.dryrun) {
        await downloadPackage(pkgs);
    }
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exit(1);
}
