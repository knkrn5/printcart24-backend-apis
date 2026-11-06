// scripts/auditBindingOptions.script.js
//
// PURPOSE:
//   Finds all print_documents that have a selectedBindingCode set to one of the
//   6 binding options being disabled, and whose cartStatus is either IN_CART or
//   AVAILABLE (i.e. not yet ordered). These documents would break at checkout
//   after the binding options are disabled.
//
// USAGE:
//   Audit only (safe, no writes):
//     node --env-file=.env scripts/auditBindingOptions.script.js
//
//   Clear the binding code from affected documents (writes to DB):
//     CLEAR_BINDING=true node --env-file=.env scripts/auditBindingOptions.script.js
//
// NOTE:
//   This script NEVER touches placed orders (print_orders collection).
//   It only touches print_documents with cartStatus IN_CART or AVAILABLE.
//   Clearing sets selectedBindingCode to '' — all other customization is preserved.

import mongoose from 'mongoose';
import chalk from 'chalk';

import { dbConnection } from '#configs/db';
import PrintDocument from '#models/printDocument';
import PrintService from '#models/printService';

// ─── Configuration ────────────────────────────────────────────────────────────

const SERVICE_SLUG = 'document-printing';

const DISABLED_BINDING_CODES = [
    'LAMINATION',
    'WIRE_O_UPTO_100',
    'SOFT_BIND_300',
    'SPIRAL_BIND_300',
    'COMB_BIND_300',
    'STAPLED_20',
];

const AFFECTED_CART_STATUSES = ['IN_CART', 'AVAILABLE'];

// Read from env: CLEAR_BINDING=true to enable writes
const CLEAR_MODE = process.env.CLEAR_BINDING === 'true';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const divider = (char = '─', len = 60) => chalk.gray(char.repeat(len));

const formatRow = (doc) => {
    const userId = doc.user?.toString() || 'N/A';
    const docId = doc._id?.toString() || 'N/A';
    const bindingCode = doc.customization?.selectedBindingCode || '';
    const status = doc.cartStatus || '';
    const fileName = doc.originalFileName || '(unnamed)';
    const pages = doc.pageCount || 0;

    return (
        chalk.white(`  Doc ID : `) + chalk.yellow(docId) + '\n' +
        chalk.white(`  User   : `) + chalk.cyan(userId) + '\n' +
        chalk.white(`  File   : `) + chalk.gray(fileName) + chalk.gray(` [${pages} page${pages !== 1 ? 's' : ''}]`) + '\n' +
        chalk.white(`  Status : `) + (status === 'IN_CART' ? chalk.red(status) : chalk.yellow(status)) + '\n' +
        chalk.white(`  Binding: `) + chalk.red(bindingCode)
    );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        console.log('\n' + divider('═'));
        console.log(chalk.bold.cyan('  BINDING OPTIONS AUDIT SCRIPT'));
        console.log(chalk.gray(`  Mode: ${CLEAR_MODE ? chalk.bgRed.white(' CLEAR MODE — WRITES ENABLED ') : chalk.bgGreen.black(' AUDIT ONLY (read-only) ')}`));
        console.log(divider('═') + '\n');

        await dbConnection();

        // 1. Resolve the service document
        const service = await PrintService.findOne({ slug: SERVICE_SLUG, isActive: true })
            .select('_id name slug')
            .lean();

        if (!service) {
            console.log(chalk.bgRed.white(`\n  Service with slug "${SERVICE_SLUG}" not found or inactive.\n`));
            process.exit(1);
        }

        console.log(chalk.green(`✔ Service found: `) + chalk.white(`${service.name}`) + chalk.gray(` (${service._id})\n`));

        // 2. Build the query
        const query = {
            service: service._id,
            isDeleted: false,
            cartStatus: { $in: AFFECTED_CART_STATUSES },
            'customization.selectedBindingCode': { $in: DISABLED_BINDING_CODES },
        };

        // 3. Fetch all affected documents
        const affectedDocs = await PrintDocument.find(query)
            .select('_id user originalFileName pageCount cartStatus customization')
            .lean();

        // 4. Group by binding code for a cleaner report
        const grouped = {};
        for (const doc of affectedDocs) {
            const code = doc.customization?.selectedBindingCode || 'UNKNOWN';
            if (!grouped[code]) grouped[code] = [];
            grouped[code].push(doc);
        }

        // 5. Print the report
        console.log(divider());
        console.log(chalk.bold(`  AUDIT RESULTS`));
        console.log(divider());

        if (affectedDocs.length === 0) {
            console.log(chalk.green('\n  ✅ No affected documents found. Safe to disable the binding options.\n'));
            process.exit(0);
        }

        console.log(
            chalk.yellow(`\n  ⚠️  Found ${affectedDocs.length} document(s) that will break at checkout.\n`)
        );

        // Summary table by binding code
        console.log(chalk.bold('  Summary by Binding Code:'));
        for (const code of DISABLED_BINDING_CODES) {
            const count = grouped[code]?.length || 0;
            if (count > 0) {
                console.log(
                    chalk.white(`    ${code.padEnd(20)}`) +
                    chalk.red(`${count} document(s)`)
                );
            }
        }

        // Status breakdown
        const inCartDocs = affectedDocs.filter((d) => d.cartStatus === 'IN_CART');
        const availableDocs = affectedDocs.filter((d) => d.cartStatus === 'AVAILABLE');

        console.log('\n' + chalk.bold('  Status Breakdown:'));
        console.log(chalk.white(`    IN_CART  : `) + chalk.red(`${inCartDocs.length} (will fail at checkout immediately)`));
        console.log(chalk.white(`    AVAILABLE: `) + chalk.yellow(`${availableDocs.length} (will fail when added to cart and checked out)`));

        // Detailed records
        console.log('\n' + divider());
        console.log(chalk.bold('  Affected Document Details:'));
        console.log(divider());

        for (const [code, docs] of Object.entries(grouped)) {
            console.log('\n' + chalk.bgYellow.black(` Binding Code: ${code} (${docs.length} document(s)) `));
            for (const doc of docs) {
                console.log('\n' + formatRow(doc));
            }
        }

        // 6. Clear logic
        if (!CLEAR_MODE) {
            console.log('\n' + divider());
            console.log(chalk.yellow('  ℹ️  This was an AUDIT RUN. No changes were made.'));
            console.log(chalk.white('  To clear the binding codes from the above documents, run:'));
            console.log(chalk.cyan('\n    CLEAR_BINDING=true node --env-file=.env scripts/auditBindingOptions.script.js\n'));
            console.log(chalk.gray('  This will set selectedBindingCode = "" on all affected documents.'));
            console.log(chalk.gray('  All other customization fields (paper size, color, sides, etc.) will be preserved.'));
            console.log(divider() + '\n');
            process.exit(0);
        }

        // ── CLEAR MODE ──────────────────────────────────────────────────────
        console.log('\n' + divider('─'));
        console.log(chalk.bgRed.white('  ⚡ CLEAR MODE ACTIVE — Updating documents...'));
        console.log(divider('─'));

        const result = await PrintDocument.updateMany(query, {
            $set: { 'customization.selectedBindingCode': '' },
        });

        console.log('\n' + chalk.green(`  ✅ Successfully cleared binding codes.`));
        console.log(chalk.white(`     Matched  : `) + chalk.cyan(`${result.matchedCount}`));
        console.log(chalk.white(`     Modified  : `) + chalk.cyan(`${result.modifiedCount}`));

        if (result.modifiedCount !== affectedDocs.length) {
            console.log(chalk.yellow(`\n  ⚠️  Warning: Modified count (${result.modifiedCount}) does not match initially found count (${affectedDocs.length}).`));
            console.log(chalk.yellow('     Some documents may have changed state between audit and update. Re-run audit to verify.'));
        }

        // Confirm zero remaining
        const remaining = await PrintDocument.countDocuments(query);
        if (remaining === 0) {
            console.log('\n' + chalk.green('  ✅ Verification passed: 0 affected documents remaining.'));
            console.log(chalk.green('     It is now safe to proceed with disabling the binding options in the DB.\n'));
        } else {
            console.log('\n' + chalk.red(`  ❌ Verification failed: ${remaining} document(s) still have the old binding codes.`));
            console.log(chalk.red('     Do NOT disable the service catalog options yet. Re-run audit to investigate.\n'));
        }

        process.exit(0);
    } catch (error) {
        console.error(chalk.bgRed.white('\n  CRITICAL ERROR:'), error.message);
        console.error(error);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('\n  MongoDB connection closed.'));
    }
})();
