import { Octokit } from "@octokit/core";

/**
 * @typedef {Object} Asset
 * @property {Number} id
 * @property {String} name
 * @property {Date} created_at
 */

/**
 * @typedef {Object} Data
 * @property {Asset[]} assets
 */

const PKG_REGEX =
    /^([a-zA-Z0-9_.+-]+)-([0-9a-zA-Z_.+-]+)-([0-9]+)-([a-zA-Z0-9_.+-]+)\.pkg\.tar\.(zst|xz|gz)$/;

const REPO_OWNER = "Bryan2333";
const REPO_NAME = "my-arch-repo";
const RELEASE_TAG = "packages";

async function deleteOldAssets() {
    const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
    });

    /**
     * @type {Data}
     */
    const data = (
        await octokit.request("GET /repos/{owner}/{repo}/releases/tags/{tag}", {
            owner: REPO_OWNER,
            repo: REPO_NAME,
            tag: RELEASE_TAG,
            headers: {
                "X-GitHub-Api-Version": "2022-11-28",
            },
        })
    ).data;

    /**
     * @type {Asset[]}
     */
    const assets = data.assets.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    /**
     * @type {Map<String, Asset[]>}
     */
    const assetMap = new Map();

    for (const asset of assets) {
        const match = asset.name.match(PKG_REGEX);

        if (match !== null) {
            const pkgname = match[1];

            if (assetMap.has(pkgname) === false) {
                assetMap.set(pkgname, []);
            }

            assetMap.get(pkgname).push(asset);
        }
    }

    /**
     * @type {Asset[]}
     */
    const assetsToRemove = [];

    for (const pkg_assets of assetMap.values()) {
        if (pkg_assets.length > 2) {
            assetsToRemove.push(...pkg_assets.slice(2));
        }
    }

    console.log(
        "===========================以下软件包将被删除=========================="
    );
    for (const asset of assetsToRemove) {
        console.log(asset.name);
    }

    await Promise.all(
        assetsToRemove.map((asset) => {
            octokit.request(
                "DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}",
                {
                    owner: REPO_OWNER,
                    repo: REPO_NAME,
                    asset_id: asset.id,
                    headers: {
                        "X-GitHub-Api-Version": "2022-11-28",
                    },
                }
            );
        })
    );
}

deleteOldAssets().catch((error) =>
    console.log("Error deleting assets:", error)
);
