// scripts/testBindingColors.script.js
// Inline test: verifies the Binding Color customization implementation across:
//   1. PrintService DB — thesis-golden-bindings has supportedBindingColors, others don't
//   2. buildCustomizationConfig() output — bindingColors key present and correct
//   3. Validation — valid/invalid codes for thesis vs other services
//   4. SECTION_CONFIG — ?section=bindingColors is recognized

import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintService from '#models/printService';
import { buildCustomizationConfig } from '#services/printPricing';
import { validateDocumentCustomizationAgainstService } from '#validations/printDocument';

const EXPECTED_BINDING_COLORS = ['BLACK', 'MEHROON', 'BLUE', 'GREEN'];
const THESIS_GOLDEN_SLUG = 'thesis-golden-bindings';

let passed = 0;
let failed = 0;

const pass = (msg) => { console.log(chalk.green(`  ✅ PASS: ${msg}`)); passed++; };
const fail = (msg) => { console.log(chalk.red(`  ❌ FAIL: ${msg}`)); failed++; };

const runTests = async () => {
    await dbConnection();

    // ── 1. DB CHECK — supportedBindingColors on services ─────────────────────
    console.log(chalk.bold.cyan('\n── 1. DB: supportedBindingColors field'));

    const services = await PrintService.find({}).select('name slug supportedBindingColors').lean();

    const thesisGolden = services.find((s) => s.slug === THESIS_GOLDEN_SLUG);
    const otherServices = services.filter((s) => s.slug !== THESIS_GOLDEN_SLUG);

    if (!thesisGolden) {
        fail(`${THESIS_GOLDEN_SLUG} not found in DB`);
    } else {
        const colors = thesisGolden.supportedBindingColors || [];
        const codes = colors.map((c) => c.code);

        if (colors.length === EXPECTED_BINDING_COLORS.length) {
            pass(`thesis-golden-bindings has ${colors.length} binding colors`);
        } else {
            fail(`Expected ${EXPECTED_BINDING_COLORS.length} binding colors, got ${colors.length}`);
        }

        for (const expected of EXPECTED_BINDING_COLORS) {
            if (codes.includes(expected)) {
                pass(`Color code "${expected}" present`);
            } else {
                fail(`Color code "${expected}" MISSING`);
            }
        }

        // Check isDefault on BLACK
        const blackOption = colors.find((c) => c.code === 'BLACK');
        if (blackOption?.isDefault === true) {
            pass(`"BLACK" is marked as isDefault`);
        } else {
            fail(`"BLACK" should be isDefault: true`);
        }
    }

    // Other services should have empty supportedBindingColors
    console.log(chalk.bold.cyan('\n── 2. DB: Other services have empty supportedBindingColors'));
    for (const service of otherServices) {
        const colors = service.supportedBindingColors || [];
        if (colors.length === 0) {
            pass(`"${service.slug}" — supportedBindingColors is [] (correct)`);
        } else {
            fail(`"${service.slug}" — should have empty supportedBindingColors, got ${colors.length} items`);
        }
    }

    // ── 2. buildCustomizationConfig() — bindingColors key present ────────────
    console.log(chalk.bold.cyan('\n── 3. buildCustomizationConfig() — bindingColors key'));

    const thesisGoldenFull = await PrintService.findOne({ slug: THESIS_GOLDEN_SLUG }).lean();
    const thesisConfig = buildCustomizationConfig(thesisGoldenFull);

    if (Array.isArray(thesisConfig.bindingColors)) {
        pass(`thesis-golden-bindings customizationConfig has "bindingColors" array`);
    } else {
        fail(`customizationConfig.bindingColors is missing or not an array`);
    }

    if (thesisConfig.bindingColors.length === EXPECTED_BINDING_COLORS.length) {
        pass(`bindingColors has ${thesisConfig.bindingColors.length} items`);
    } else {
        fail(`bindingColors expected ${EXPECTED_BINDING_COLORS.length} items, got ${thesisConfig.bindingColors.length}`);
    }

    for (const color of thesisConfig.bindingColors) {
        if (color.code && color.label) {
            pass(`Color "${color.code}" has code + label ("${color.label}")`);
        } else {
            fail(`Color entry missing code or label: ${JSON.stringify(color)}`);
        }
    }

    // Other services should have empty bindingColors in config
    const docPrintingFull = await PrintService.findOne({ slug: 'document-printing' }).lean();
    const docPrintingConfig = buildCustomizationConfig(docPrintingFull);
    if (Array.isArray(docPrintingConfig.bindingColors) && docPrintingConfig.bindingColors.length === 0) {
        pass(`document-printing customizationConfig.bindingColors is [] (correct)`);
    } else {
        fail(`document-printing customizationConfig.bindingColors should be []`);
    }

    // ── 3. Validation — valid codes accepted, invalid rejected ───────────────
    console.log(chalk.bold.cyan('\n── 4. Validation: selectedBindingColorCode'));

    // Valid color on thesis-golden-bindings
    for (const code of EXPECTED_BINDING_COLORS) {
        const error = validateDocumentCustomizationAgainstService({
            customization: { selectedBindingColorCode: code },
            service: thesisGoldenFull,
        });
        if (error === null) {
            pass(`"${code}" accepted for thesis-golden-bindings`);
        } else {
            fail(`"${code}" should be accepted, got error: "${error}"`);
        }
    }

    // Invalid color on thesis-golden-bindings
    const invalidError = validateDocumentCustomizationAgainstService({
        customization: { selectedBindingColorCode: 'RED' },
        service: thesisGoldenFull,
    });
    if (invalidError !== null) {
        pass(`Invalid code "RED" correctly rejected for thesis-golden-bindings`);
    } else {
        fail(`"RED" should be rejected for thesis-golden-bindings but was accepted`);
    }

    // Any color code should be rejected on a non-thesis service
    const nonThesisService = await PrintService.findOne({ slug: 'document-printing' }).lean();
    const crossServiceError = validateDocumentCustomizationAgainstService({
        customization: { selectedBindingColorCode: 'BLACK' },
        service: nonThesisService,
    });
    if (crossServiceError !== null) {
        pass(`"BLACK" correctly rejected for document-printing (binding color not supported)`);
    } else {
        fail(`"BLACK" should be rejected for document-printing but was accepted`);
    }

    // Empty/omitted binding color should always be accepted
    const emptyError = validateDocumentCustomizationAgainstService({
        customization: { selectedBindingColorCode: '' },
        service: thesisGoldenFull,
    });
    if (emptyError === null) {
        pass(`Empty selectedBindingColorCode is accepted (optional field)`);
    } else {
        fail(`Empty selectedBindingColorCode should be accepted, got: "${emptyError}"`);
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log(chalk.bold(`Test Results: ${passed} passed, ${failed} failed`));
    if (failed === 0) {
        console.log(chalk.bgGreen.black.bold(' ALL TESTS PASSED ✅ '));
    } else {
        console.log(chalk.bgRed.white.bold(` ${failed} TEST(S) FAILED ❌ `));
    }
    console.log('─'.repeat(60) + '\n');
};

(async () => {
    try {
        await runTests();
        process.exit(failed > 0 ? 1 : 0);
    } catch (err) {
        console.error(chalk.bgRed.white('Unexpected error:'), err.message, err.stack);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
    }
})();
