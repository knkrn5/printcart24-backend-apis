// scripts/testUserSearch.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import User from '#models/user';

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function runSearch(searchQuery) {
    const searchString = searchQuery.trim();
    const escapedSearch = escapeRegExp(searchString);
    const regex = { $regex: escapedSearch, $options: 'i' };

    const searchNoSpaces = searchString.replace(/\s+/g, '');
    const escapedSearchNoSpaces = escapeRegExp(searchNoSpaces);
    const regexNoSpaces = { $regex: escapedSearchNoSpaces, $options: 'i' };

    const filter = {
        isDeleted: false,
        $or: [
            { fullName: regex },
            { email: regex },
            { phone: regexNoSpaces },
            {
                $expr: {
                    $regexMatch: {
                        input: { $concat: [{ $ifNull: ["$countryCode", ""] }, { $ifNull: ["$phone", ""] }] },
                        regex: escapedSearchNoSpaces,
                        options: "i"
                    }
                }
            }
        ]
    };

    return await User.find(filter).lean();
}

(async () => {
    try {
        console.log(chalk.blue('Connecting to database...'));
        await dbConnection();

        // Use a unique email/phone to avoid collision
        const testEmail = 'searchtest.user.temp@example.com';
        const testPhone = '9876543000'; // Unique number for tests
        const testCountryCode = '+91';

        // Clean up any stray test user from previous runs
        console.log(chalk.blue('Cleaning up existing users with test email/phone...'));
        await User.deleteMany({
            $or: [
                { email: testEmail },
                { phone: testPhone }
            ]
        });

        console.log(chalk.blue('Creating a temporary test user...'));
        const testUser = await User.create({
            firstName: 'SearchTest',
            lastName: 'User',
            fullName: 'SearchTest User',
            countryCode: testCountryCode,
            phone: testPhone,
            email: testEmail,
            isActive: true,
            isDeleted: false
        });

        console.log(chalk.green(`Created test user: ID=${testUser._id}, Phone=${testCountryCode} ${testPhone}\n`));

        // Define test cases
        const testCases = [
            { query: '+91', shouldMatch: true, desc: 'Country code only' },
            { query: `+91${testPhone}`, shouldMatch: true, desc: 'Full country code + phone without space' },
            { query: `+91 ${testPhone}`, shouldMatch: true, desc: 'Full country code + phone with space' },
            { query: testPhone, shouldMatch: true, desc: 'Phone number only' },
            { query: '+919876', shouldMatch: true, desc: 'Partial prefix search' },
            { query: '543000', shouldMatch: true, desc: 'Partial suffix search' },
            { query: 'SearchTest', shouldMatch: true, desc: 'Name search' },
            { query: testEmail, shouldMatch: true, desc: 'Email search' },
            { query: 'nonexistent', shouldMatch: false, desc: 'Non-matching string' }
        ];

        let allPassed = true;

        for (const testCase of testCases) {
            const results = await runSearch(testCase.query);
            const isMatched = results.some(u => u._id.toString() === testUser._id.toString());

            const statusText = isMatched === testCase.shouldMatch
                ? chalk.green('✓ PASS')
                : chalk.red('✗ FAIL');

            if (isMatched !== testCase.shouldMatch) {
                allPassed = false;
            }

            console.log(
                `${statusText} | Query: "${testCase.query}" (${testCase.desc}) | Expected Match: ${testCase.shouldMatch} | Got Match: ${isMatched}`
            );
        }

        console.log(chalk.blue('\nCleaning up test user...'));
        await User.deleteOne({ _id: testUser._id });

        if (allPassed) {
            console.log(chalk.bold.green('\n🎉 All test cases passed successfully!'));
        } else {
            console.log(chalk.bold.red('\n❌ Some test cases failed. Please review.'));
        }

        process.exit(allPassed ? 0 : 1);
    } catch (err) {
        console.error(chalk.red('Error during search verification:'), err);
        process.exit(1);
    }
})();
