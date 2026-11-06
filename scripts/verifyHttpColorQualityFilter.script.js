// scripts/verifyHttpColorQualityFilter.script.js
import mongoose from "mongoose";
import chalk from "chalk";
import { dbConnection } from "#configs/db";
import PrintService from "#models/printService";
import env from "#configs/env";

const PORT      = env.PORT || 5100;
const BASE_URL  = "http://localhost:" + PORT + "/api/print-services";
const POSTER_CODES = ["POSTER_STANDARD", "GLOSSY", "FABRIC"];
const divider = (c = "─", n = 64) => chalk.gray(c.repeat(n));

const fetchQuals = async (slug, params) => {
    const url = BASE_URL + "/" + slug + "?section=paperQualities" + (params ? "&" + params : "");
    const res  = await fetch(url);
    const json = await res.json();
    return { quals: json?.data?.customizationConfig?.paperQualities ?? [], url };
};

let totalPass = 0, totalFail = 0;
const failLog = [];

const assert = (slug, label, condition, got, expected) => {
    if (condition) {
        totalPass++;
        console.log(chalk.green("    PASS"), label);
        if (got.length) console.log("         codes: [" + got.join(", ") + "]");
    } else {
        totalFail++;
        console.log(chalk.red("    FAIL"), label);
        console.log(chalk.red("         got:"),      "[" + got.join(", ")      + "]");
        console.log(chalk.red("         expected:"), "[" + expected.join(", ") + "]");
        failLog.push({ slug, label });
    }
};

(async () => {
    try {
        await dbConnection();

        const services = await PrintService
            .find({ isActive: true })
            .select("slug name supportedPaperQualities")
            .sort({ sortOrder: 1 })
            .lean();

        await mongoose.disconnect();

        console.log("\n" + divider("═"));
        console.log(chalk.bold.cyan("  HTTP API — COLOR-FILTERED PAPER QUALITY VERIFICATION"));
        console.log(chalk.gray("  " + BASE_URL + "/:slug?section=paperQualities&colorCode=..."));
        console.log(divider("═") + "\n");

        for (const svc of services) {
            const slug     = svc.slug;
            const isPoster = slug === "poster-printing";
            const dbCodes  = (svc.supportedPaperQualities || [])
                .filter(q => q.isActive !== false)
                .map(q => q.code);
            const hasPQ = dbCodes.length > 0;

            console.log(divider());
            console.log(chalk.bold("  " + svc.name + "  [" + chalk.white(slug) + "]"));
            console.log(chalk.gray("  DB paper qualities: [" + (dbCodes.join(", ") || "none") + "]"));
            console.log("");

            // ── No colorCode → unfiltered ───────────────────────────────
            const { quals: qNone } = await fetchQuals(slug, "");
            const qNoneCodes = qNone.map(q => q.code);
            if (hasPQ) {
                const allPresent = dbCodes.every(c => qNoneCodes.includes(c));
                assert(slug, "?section=paperQualities (no colorCode) → all DB qualities present",
                    allPresent, qNoneCodes, dbCodes);
            } else {
                assert(slug, "?section=paperQualities (no colorCode) → empty list (no PQ configured)",
                    qNone.length === 0, qNoneCodes, []);
            }

            if (!hasPQ) { console.log(""); continue; }

            // ── colorCode=BW ────────────────────────────────────────────
            const { quals: qBW } = await fetchQuals(slug, "colorCode=BW");
            const qBWCodes = qBW.map(q => q.code);

            if (isPoster) {
                assert(slug, "colorCode=BW → exactly [POSTER_STANDARD]",
                    qBWCodes.length === 1 && qBWCodes[0] === "POSTER_STANDARD",
                    qBWCodes, ["POSTER_STANDARD"]);
            } else {
                const noLoss   = dbCodes.every(c => qBWCodes.includes(c));
                const noLeak   = qBWCodes.filter(c => POSTER_CODES.includes(c));
                assert(slug, "colorCode=BW → no existing qualities removed",
                    noLoss, qBWCodes, dbCodes);
                assert(slug, "colorCode=BW → no poster-specific codes leaked",
                    noLeak.length === 0, noLeak, []);
            }

            // ── colorCode=COLOR ─────────────────────────────────────────
            const { quals: qCOLOR } = await fetchQuals(slug, "colorCode=COLOR");
            const qCOLORCodes = qCOLOR.map(q => q.code);

            if (isPoster) {
                const hasGlossy = qCOLORCodes.includes("GLOSSY");
                const hasFabric = qCOLORCodes.includes("FABRIC");
                assert(slug, "colorCode=COLOR → exactly [GLOSSY, FABRIC]",
                    qCOLORCodes.length === 2 && hasGlossy && hasFabric,
                    qCOLORCodes, ["GLOSSY", "FABRIC"]);
            } else {
                const noLoss = dbCodes.every(c => qCOLORCodes.includes(c));
                const noLeak = qCOLORCodes.filter(c => POSTER_CODES.includes(c));
                assert(slug, "colorCode=COLOR → no existing qualities removed",
                    noLoss, qCOLORCodes, dbCodes);
                assert(slug, "colorCode=COLOR → no poster-specific codes leaked",
                    noLeak.length === 0, noLeak, []);
            }

            // ── Case-insensitive: colorCode=bw must match colorCode=BW ──
            const { quals: qbw }    = await fetchQuals(slug, "colorCode=bw");
            const { quals: qcolor } = await fetchQuals(slug, "colorCode=color");
            const bwMatch    = qbw.map(q=>q.code).sort().join(",") === qBWCodes.sort().join(",");
            const colorMatch = qcolor.map(q=>q.code).sort().join(",") === qCOLORCodes.sort().join(",");
            assert(slug, "colorCode=bw (lowercase) === colorCode=BW",
                bwMatch, qbw.map(q=>q.code), qBWCodes);
            assert(slug, "colorCode=color (lowercase) === colorCode=COLOR",
                colorMatch, qcolor.map(q=>q.code), qCOLORCodes);

            console.log("");
        }

        console.log(divider("═"));
        console.log(chalk.bold("  TOTAL: " + chalk.green(totalPass + " passed") + ", " + (totalFail > 0 ? chalk.red(totalFail + " failed") : chalk.green("0 failed"))));

        if (totalFail > 0) {
            console.log(chalk.red.bold("\n  FAILED CHECKS:"));
            failLog.forEach(f => console.log(chalk.red("    ✘ [" + f.slug + "] " + f.label)));
        }
        console.log(divider("═") + "\n");

        process.exit(totalFail > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.red("\nFatal error:"), err.message);
        process.exit(1);
    }
})();
