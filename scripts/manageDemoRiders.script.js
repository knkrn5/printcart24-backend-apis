// scripts/manageDemoRiders.script.js
//
// PURPOSE: Interactive CLI for managing DEMO Rider/Partner users in the
//          PrintCart24 database. Supports add, list, remove, and bulk-remove
//          operations with full safety guards.
//
// USAGE:
//   node --env-file=.env scripts/manageDemoRiders.script.js
//
// DEMO RIDER IDENTIFICATION:
//   Demo riders are identified by their email prefix: "demo.rider."
//   This regex-based strategy avoids any schema modifications and never
//   touches real production rider records.
//
// NOTE: This is a development/test data script only.
//       It does NOT modify any production business logic.

import mongoose from 'mongoose';
import readline from 'readline';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import Partner from '#models/partner';
import PrintOrder from '#models/printOrder';

/* ─────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────── */

const SCRIPT_TAG = '[manageDemoRiders]';
const DEMO_EMAIL_PREFIX = 'demo.rider.';
const DEMO_EMAIL_REGEX = /^demo\.rider\./;
const DEMO_PASSWORD = 'DemoRider@1234';
const MAX_PHONE_ATTEMPTS = 50;

const FIRST_NAMES = [
    'Aarav', 'Vivaan', 'Aditya', 'Arjun', 'Sai',
    'Rohan', 'Vihaan', 'Krishna', 'Reyansh', 'Dhruv',
    'Ananya', 'Diya', 'Ishita', 'Priya', 'Neha',
    'Kavya', 'Aisha', 'Riya', 'Meera', 'Saanvi',
    'Rahul', 'Karan', 'Nikhil', 'Amit', 'Sanjay',
    'Pooja', 'Swati', 'Divya', 'Deepa', 'Kavitha',
    'Vikram', 'Manish', 'Rajesh', 'Suresh', 'Prakash',
    'Lakshmi', 'Geeta', 'Sunita', 'Rekha', 'Shanti',
];

const LAST_NAMES = [
    'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar',
    'Patel', 'Reddy', 'Nair', 'Iyer', 'Mishra',
    'Joshi', 'Rao', 'Chatterjee', 'Banerjee', 'Das',
    'Mehta', 'Kapoor', 'Malhotra', 'Chauhan', 'Tiwari',
    'Pandey', 'Srivastava', 'Chandra', 'Prasad', 'Agarwal',
];

const log = {
    info:    (msg) => console.log(chalk.cyan(`${SCRIPT_TAG} ${msg}`)),
    success: (msg) => console.log(chalk.green(`${SCRIPT_TAG} ${msg}`)),
    warn:    (msg) => console.log(chalk.yellow(`${SCRIPT_TAG} ${msg}`)),
    error:   (msg) => console.error(chalk.red(`${SCRIPT_TAG} ${msg}`)),
    section: (msg) => console.log(chalk.bold.magenta(`\n${SCRIPT_TAG} -- ${msg} --`)),
    divider: ()    => console.log(chalk.gray('\u2500'.repeat(72))),
};

/* ─────────────────────────────────────────────
   Readline Helpers
   ───────────────────────────────────────────── */

let rlClosed = false;
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
rl.on('close', () => { rlClosed = true; });

const ask = (question) => {
    if (rlClosed) return Promise.resolve('');
    return new Promise((resolve) => rl.question(question, resolve));
};

const askNumber = async (question) => {
    const raw = await ask(question);
    const n = parseInt(raw.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
};

/* ─────────────────────────────────────────────
   Data Generation Helpers
   ───────────────────────────────────────────── */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const generatePhone = (seq) => {
    const prefix = ['6', '7', '8', '9'][seq % 4];
    const body = String(Date.now() % 1_000_000_00).padStart(9, '0');
    return `${prefix}${body.slice(0, 9)}`;
};

const generateEmail = (firstName, lastName, seq) => {
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
    const ts = Date.now().toString(36);
    return `${DEMO_EMAIL_PREFIX}${cleanFirst}.${cleanLast}.${ts}.${seq}@demo.local`;
};

const generateDemoRiderData = (seq) => {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = generateEmail(firstName, lastName, seq);
    const phone = generatePhone(seq);

    return {
        firstName,
        lastName,
        email,
        phone,
        password: DEMO_PASSWORD,
        countryCode: '+91',
        role: 'rider',
        accountStatus: 'PENDING',
        isActive: true,
        isDeleted: false,
    };
};

/* ─────────────────────────────────────────────
   Demo Rider Query Helper
   ───────────────────────────────────────────── */

const getDemoQuery = () => ({
    email: DEMO_EMAIL_REGEX,
    isDeleted: false,
});

/* ─────────────────────────────────────────────
   Core Operations
   ───────────────────────────────────────────── */

const createDemoRiders = async (count) => {
    log.section(`Creating ${count} demo rider(s)`);
    const results = { created: 0, failed: 0, riders: [] };

    for (let i = 1; i <= count; i++) {
        try {
            const data = generateDemoRiderData(i);

            const partner = await Partner.create(data);
            results.created += 1;

            const summary = {
                index:       `${i}/${count}`,
                id:          partner._id.toString(),
                name:        partner.fullName || `${partner.firstName} ${partner.lastName}`,
                email:       partner.email,
                mobile:      `${partner.countryCode} ${partner.phone}`,
                role:        partner.role,
                status:      partner.accountStatus,
                createdAt:   partner.createdAt,
            };
            results.riders.push(summary);

            log.success(
                `[${summary.index}] ${chalk.bold(summary.name)} ` +
                `| ${summary.email} | ${summary.mobile} | ${summary.status}`,
            );
        } catch (err) {
            results.failed += 1;
            log.error(`[${i}/${count}] Failed: ${err.message}`);
        }
    }

    return results;
};

const listDemoRiders = async () => {
    const riders = await Partner.find(getDemoQuery())
        .select('firstName lastName fullName email phone countryCode role accountStatus createdAt')
        .sort({ createdAt: -1 })
        .lean();
    return riders;
};

const removeDemoRiders = async (ids) => {
    const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
    const result = await Partner.deleteMany({
        _id: { $in: objectIds },
        ...getDemoQuery(),
    });
    return result.deletedCount;
};

/* ─────────────────────────────────────────────
   Order Linkage Check
   ───────────────────────────────────────────── */

const getOrderCountsByPartner = async (partnerIds) => {
    const objectIds = partnerIds.map((id) => new mongoose.Types.ObjectId(id));

    const results = await PrintOrder.aggregate([
        { $match: { assignedPartner: { $in: objectIds } } },
        { $group: { _id: '$assignedPartner', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    for (const doc of results) {
        countMap[doc._id.toString()] = doc.count;
    }
    return countMap;
};

/* ─────────────────────────────────────────────
   Display Helpers
   ───────────────────────────────────────────── */

const printRiderTable = (riders) => {
    if (riders.length === 0) {
        log.warn('No demo riders found.');
        return;
    }

    log.section(`Demo Riders (${riders.length} total)`);
    log.divider();

    const header = [
        ' #'.padEnd(5),
        'Rider ID'.padEnd(26),
        'Name'.padEnd(22),
        'Email'.padEnd(38),
        'Mobile'.padEnd(16),
        'Status'.padEnd(10),
        'Created At',
    ].join('  ');

    console.log(chalk.bold.white(`  ${header}`));
    log.divider();

    riders.forEach((r, i) => {
        const name = r.fullName || `${r.firstName || ''} ${r.lastName || ''}`.trim() || '(none)';
        const created = r.createdAt
            ? new Date(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
            : '(unknown)';

        const row = [
            String(i + 1).padEnd(5),
            String(r._id).padEnd(26),
            name.padEnd(22),
            (r.email || '').padEnd(38),
            `${r.countryCode || '+91'} ${r.phone || '(none)'}`.padEnd(16),
            (r.accountStatus || '').padEnd(10),
            created,
        ].join('  ');

        console.log(chalk.white(`  ${row}`));
    });

    log.divider();
};

/* ─────────────────────────────────────────────
   Menu Operations
   ───────────────────────────────────────────── */

const handleAdd = async () => {
    const count = await askNumber('\n  How many demo riders do you want to create? ');

    if (!count || count <= 0) {
        log.warn('Please enter a positive number.');
        return;
    }

    console.log(chalk.white(`\n  Creating ${count} demo rider(s)...\n`));

    const results = await createDemoRiders(count);

    log.divider();
    console.log(chalk.bold.green(
        `  Result: ${results.created} created, ${results.failed} failed`,
    ));

    if (results.riders.length > 0) {
        console.log(chalk.bold.cyan('\n  Demo Rider Credentials (development only):'));
        console.log(chalk.white(`  Password (shared): ${DEMO_PASSWORD}\n`));
        for (const r of results.riders) {
            console.log(chalk.white(`    ${r.name}  ->  ${r.email}`));
        }
    }

    console.log('');
};

const handleList = async () => {
    const riders = await listDemoRiders();
    printRiderTable(riders);
    console.log('');
};

const handleRemoveSelected = async () => {
    const riders = await listDemoRiders();

    if (riders.length === 0) {
        console.log('');
        return;
    }

    console.log(chalk.white('\n  Enter the rider numbers to remove (comma-separated, e.g. 1,3,5):'));
    const input = await ask('  > ');

    const indices = input.split(',').map((s) => {
        const n = parseInt(s.trim(), 10);
        return Number.isFinite(n) && n >= 1 && n <= riders.length ? n - 1 : -1;
    }).filter((i) => i >= 0);

    if (indices.length === 0) {
        log.warn('No valid rider numbers selected.');
        return;
    }

    const selected = indices.map((i) => riders[i]);
    const selectedIds = selected.map((r) => r._id.toString());

    let orderCountMap;
    try {
        orderCountMap = await getOrderCountsByPartner(selectedIds);
    } catch (err) {
        log.error(`Order lookup failed: ${err.message}`);
        log.warn('No riders deleted. Could not verify order linkage.');
        console.log('');
        return;
    }

    const deletable = [];
    const protectedList = [];

    for (const r of selected) {
        const rid = r._id.toString();
        const orderCount = orderCountMap[rid] || 0;
        if (orderCount > 0) {
            protectedList.push({ rider: r, orderCount });
        } else {
            deletable.push(r);
        }
    }

    log.section('Deletion Check');
    for (const r of selected) {
        const rid = r._id.toString();
        const name = r.fullName || `${r.firstName} ${r.lastName}`;
        const orderCount = orderCountMap[rid] || 0;
        if (orderCount > 0) {
            console.log(chalk.red(`  Rider: ${name}`));
            console.log(chalk.red(`  Orders: ${orderCount}`));
            console.log(chalk.red.bold('  Status: PROTECTED - HAS ORDERS'));
        } else {
            console.log(chalk.green(`  Rider: ${name}`));
            console.log(chalk.green('  Orders: 0'));
            console.log(chalk.green.bold('  Status: CAN DELETE'));
        }
        console.log('');
    }

    if (protectedList.length > 0) {
        console.log(chalk.yellow('  Protected Riders will NOT be deleted.'));
    }

    if (deletable.length === 0) {
        log.warn('All selected riders have linked orders. Nothing to delete.');
        console.log('');
        return;
    }

    console.log(chalk.bold.green(`\n  Riders to be deleted (${deletable.length}):`));
    for (const r of deletable) {
        const name = r.fullName || `${r.firstName} ${r.lastName}`;
        console.log(chalk.white(`    - ${name} (${r.email})`));
    }

    if (protectedList.length > 0) {
        console.log(chalk.bold.yellow(`\n  Riders to be SKIPPED (${protectedList.length}):`));
        for (const { rider: r, orderCount } of protectedList) {
            const name = r.fullName || `${r.firstName} ${r.lastName}`;
            console.log(chalk.yellow(`    - ${r._id} | ${name} | ${r.email} | ${orderCount} order(s)`));
        }
    }

    const confirm = await ask('\n  Type DELETE to confirm (or anything else to cancel): ');
    if (confirm.trim() !== 'DELETE') {
        log.info('Deletion cancelled.');
        return;
    }

    const ids = deletable.map((r) => r._id.toString());
    const deleted = await removeDemoRiders(ids);

    console.log('');
    log.success(`Successfully deleted: ${deleted}`);
    if (protectedList.length > 0) {
        log.warn(`Protected because of linked orders: ${protectedList.length}`);
        for (const { rider: r, orderCount } of protectedList) {
            const name = r.fullName || `${r.firstName} ${r.lastName}`;
            console.log(chalk.yellow(
                `    ${r._id} | ${name} | ${r.email} | ${orderCount} order(s)`,
            ));
        }
    }
    console.log('');
};

const handleRemoveAll = async () => {
    const riders = await listDemoRiders();
    const count = riders.length;

    if (count === 0) {
        console.log('');
        return;
    }

    const allIds = riders.map((r) => r._id.toString());

    let orderCountMap;
    try {
        orderCountMap = await getOrderCountsByPartner(allIds);
    } catch (err) {
        log.error(`Order lookup failed: ${err.message}`);
        log.warn('No riders deleted. Could not verify order linkage.');
        console.log('');
        return;
    }

    const deletable = [];
    const protectedList = [];

    for (const r of riders) {
        const rid = r._id.toString();
        const orderCount = orderCountMap[rid] || 0;
        if (orderCount > 0) {
            protectedList.push({ rider: r, orderCount });
        } else {
            deletable.push(r);
        }
    }

    log.section('Demo Rider Removal Check');
    console.log(chalk.white(`  Total Demo Riders: ${count}`));
    console.log(chalk.green.bold(`  Can Delete: ${deletable.length}`));
    console.log(chalk.red.bold(`  Protected: ${protectedList.length}`));

    if (protectedList.length > 0) {
        console.log(chalk.bold.yellow('\n  Protected Riders:'));
        for (const { rider: r, orderCount } of protectedList) {
            const name = r.fullName || `${r.firstName} ${r.lastName}`;
            console.log(chalk.yellow(`    ${name} — ${orderCount} order(s)`));
        }
    }
    console.log('');

    if (deletable.length === 0) {
        log.warn('All demo riders have linked orders. Nothing to delete.');
        console.log('');
        return;
    }

    console.log(chalk.bold.red(`\n  WARNING: This will permanently delete ${deletable.length} demo rider(s).\n`));

    const confirm = await ask('  Type DELETE ALL to confirm (or anything else to cancel): ');
    if (confirm.trim() !== 'DELETE ALL') {
        log.info('Deletion cancelled.');
        return;
    }

    const ids = deletable.map((r) => r._id.toString());
    const deleted = await removeDemoRiders(ids);

    console.log('');
    log.success(`Deleted: ${deleted}`);
    if (protectedList.length > 0) {
        log.warn(`Protected: ${protectedList.length}`);
        for (const { rider: r, orderCount } of protectedList) {
            const name = r.fullName || `${r.firstName} ${r.lastName}`;
            console.log(chalk.yellow(
                `    ${r._id} | ${name} | ${r.email} | ${orderCount} order(s)`,
            ));
        }
    }
    console.log(chalk.gray('\n  No linked orders were modified.'));
    console.log('');
};

/* ─────────────────────────────────────────────
   Main Menu Loop
   ───────────────────────────────────────────── */

const showMenu = async () => {
    console.log(chalk.bold.cyan('\n========================================'));
    console.log(chalk.bold.cyan(' PrintCart24 Demo Rider Manager'));
    console.log(chalk.bold.cyan('========================================'));
    console.log(chalk.white('  1. Add Demo Riders'));
    console.log(chalk.white('  2. List Demo Riders'));
    console.log(chalk.white('  3. Remove Demo Rider(s)'));
    console.log(chalk.white('  4. Remove All Demo Riders'));
    console.log(chalk.white('  5. Exit'));
    log.divider();

    const choice = await ask('  Select an option: ');
    return choice.trim();
};

/* ─────────────────────────────────────────────
   Cleanup Helpers
   ───────────────────────────────────────────── */

const closeDatabase = async () => {
    try {
        await mongoose.connection.close();
        log.info('MongoDB connection closed.');
    } catch {
        // connection may already be closed
    }
};

/* ─────────────────────────────────────────────
   Main
   ───────────────────────────────────────────── */

(async () => {
    console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════════╗'));
    console.log(chalk.bold.cyan('  ║   PrintCart24 Demo Rider Manager             ║'));
    console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════════╝'));

    let running = true;

    const shutdown = async () => {
        if (!running) return;
        running = false;
        rlClosed = true;
        console.log('');
        log.info('Shutting down...');
        rl.close();
        await closeDatabase();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        log.info('Connecting to MongoDB...');
        await dbConnection();
        log.success('MongoDB connected.');

        while (running && !rlClosed) {
            const choice = await showMenu();

            switch (choice) {
                case '1':
                    await handleAdd();
                    break;
                case '2':
                    await handleList();
                    break;
                case '3':
                    await handleRemoveSelected();
                    break;
                case '4':
                    await handleRemoveAll();
                    break;
                case '5':
                    running = false;
                    break;
                default:
                    log.warn('Invalid option. Please select 1-5.');
                    break;
            }
        }
    } catch (err) {
        log.error(`Fatal error: ${err.message}`);
        console.error(err);
    } finally {
        rl.close();
        await closeDatabase();
        process.exit(0);
    }
})();
