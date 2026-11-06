// scripts/migrateMimeTypes.script.js
import mongoose from 'mongoose';
import chalk from 'chalk';
import { dbConnection } from '#configs/db';
import PrintDocument from '#models/printDocument';

(async () => {
    try {
        console.log(chalk.blue('Connecting to the database...'));
        await dbConnection();
        console.log(chalk.green('Database connected successfully.'));

        // Query active/in-cart documents with docx/doc extensions and generic octet-stream mime type
        const queryDocx = {
            fileExtension: 'docx',
            mimeType: 'application/octet-stream',
            isDeleted: false,
            cartStatus: { $in: ['AVAILABLE', 'IN_CART'] }
        };

        const queryDoc = {
            fileExtension: 'doc',
            mimeType: 'application/octet-stream',
            isDeleted: false,
            cartStatus: { $in: ['AVAILABLE', 'IN_CART'] }
        };

        console.log(chalk.yellow('Auditing documents for migration...'));
        const docxCount = await PrintDocument.countDocuments(queryDocx);
        const docCount = await PrintDocument.countDocuments(queryDoc);

        console.log(chalk.cyan(`Found ${docxCount} docx documents and ${docCount} doc documents needing migration.`));

        if (docxCount > 0) {
            const resultDocx = await PrintDocument.updateMany(queryDocx, {
                $set: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
            });
            console.log(chalk.green(`Successfully migrated ${resultDocx.modifiedCount} docx documents.`));
        }

        if (docCount > 0) {
            const resultDoc = await PrintDocument.updateMany(queryDoc, {
                $set: { mimeType: 'application/msword' }
            });
            console.log(chalk.green(`Successfully migrated ${resultDoc.modifiedCount} doc documents.`));
        }

        if (docxCount === 0 && docCount === 0) {
            console.log(chalk.yellow('No documents found that require migration.'));
        }

        console.log(chalk.green('Migration completed successfully.'));
        process.exit(0);
    } catch (error) {
        console.error(chalk.red('Migration error:'), error.message);
        process.exit(1);
    } finally {
        await mongoose.connection.close();
        console.log(chalk.blue('Database connection closed.'));
    }
})();
