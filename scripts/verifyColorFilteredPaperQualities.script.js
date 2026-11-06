// scripts/verifyColorFilteredPaperQualities.script.js
// Verifies: GET /api/print-services/:slug?section=paperQualities&colorCode=...
// Run with: npm run script scripts/verifyColorFilteredPaperQualities.script.js

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '../models/printService.model.js';
import { buildFilteredPrintServiceDetailResponse } from '../services/printPricing.service.js';

const section = 'paperQualities';

const run = async () => {
    await dbConnection();

    const [poster, document, thesis] = await Promise.all([
        PrintService.findOne({ slug: 'poster-printing',   isActive: true }).select('-__v').lean(),
        PrintService.findOne({ slug: 'document-printing', isActive: true }).select('-__v').lean(),
        PrintService.findOne({ slug: 'thesis-printing',   isActive: true }).select('-__v').lean(),
    ]);

    if (!poster)   throw new Error('poster-printing not found in DB');
    if (!document) throw new Error('document-printing not found in DB');
    if (!thesis)   throw new Error('thesis-printing not found in DB');

    let passed = 0, failed = 0;

    const assert = (desc, actual, expectedCodes) => {
        const actualCodes = actual.map((q) => q.code);
        const ok =
            actualCodes.length === expectedCodes.length &&
            expectedCodes.every((c) => actualCodes.includes(c));
        if (ok) {
            console.log(chalk.green('  PASS'), desc);
            console.log(`       returned: [${actualCodes.join(', ')}]`);
            passed++;
        } else {
            console.log(chalk.red('  FAIL'), desc);
            console.log(`       expected: [${expectedCodes.join(', ')}]`);
            console.log(`       received: [${actualCodes.join(', ')}]`);
            failed++;
        }
    };

    console.log(chalk.bold.cyan('\n  PAPER QUALITY COLOR-FILTER VERIFICATION\n'));

    // Case 1: No colorCode - unfiltered (backward compat)
    console.log(chalk.bold('Case 1 - No colorCode (backward-compatible)'));
    {
        const payload = await buildFilteredPrintServiceDetailResponse(poster, section);
        assert('Poster Printing returns all 3 qualities when colorCode is absent',
            payload.customizationConfig.paperQualities,
            ['POSTER_STANDARD', 'GLOSSY', 'FABRIC']);
    }

    // Case 2: colorCode=BW
    console.log(chalk.bold('\nCase 2 - colorCode=BW'));
    {
        const payload = await buildFilteredPrintServiceDetailResponse(poster, section, { colorCode: 'BW' });
        assert('Poster Printing returns only POSTER_STANDARD for BW',
            payload.customizationConfig.paperQualities,
            ['POSTER_STANDARD']);
    }

    // Case 3: colorCode=COLOR
    console.log(chalk.bold('\nCase 3 - colorCode=COLOR'));
    {
        const payload = await buildFilteredPrintServiceDetailResponse(poster, section, { colorCode: 'COLOR' });
        assert('Poster Printing returns only GLOSSY + FABRIC for COLOR',
            payload.customizationConfig.paperQualities,
            ['GLOSSY', 'FABRIC']);
    }

    // Case 4: Case-insensitive
    console.log(chalk.bold('\nCase 4 - Case-insensitive colorCode'));
    {
        const p1 = await buildFilteredPrintServiceDetailResponse(poster, section, { colorCode: 'bw' });
        assert('colorCode=bw (lowercase) behaves same as BW',
            p1.customizationConfig.paperQualities, ['POSTER_STANDARD']);

        const p2 = await buildFilteredPrintServiceDetailResponse(poster, section, { colorCode: 'color' });
        assert('colorCode=color (lowercase) behaves same as COLOR',
            p2.customizationConfig.paperQualities, ['GLOSSY', 'FABRIC']);
    }

    // Case 5: Other services unaffected
    console.log(chalk.bold('\nCase 5 - Other services unaffected'));
    {
        const p1 = await buildFilteredPrintServiceDetailResponse(document, section, { colorCode: 'BW' });
        assert('Document Printing: all qualities returned when colorCode=BW',
            p1.customizationConfig.paperQualities,
            ['STANDARD_70_75_GSM', 'SPECIAL_100_GSM']);

        const p2 = await buildFilteredPrintServiceDetailResponse(thesis, section, { colorCode: 'COLOR' });
        assert('Thesis Printing: all qualities returned when colorCode=COLOR',
            p2.customizationConfig.paperQualities,
            ['SPECIAL_100_GSM', 'BOND_100_GSM']);
    }

    console.log('\n' + '-'.repeat(52));
    console.log(`  Results: ${chalk.green(passed + ' passed')}, ${failed > 0 ? chalk.red(failed + ' failed') : chalk.green('0 failed')}`);
    console.log('-'.repeat(52) + '\n');

    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
};

run().catch((err) => {
    console.error(chalk.red('\nScript error:'), err.message);
    process.exit(1);
});
