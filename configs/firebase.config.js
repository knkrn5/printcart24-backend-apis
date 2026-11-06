// configs/firebase.config.js
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.resolve(__dirname, '../printcampus-6243d-firebase-adminsdk.json');

let firebaseAdmin;

try {
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`\nFirebase service account file not found: ${serviceAccountPath}`);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

    firebaseAdmin = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });

    console.log(chalk.green('Firebase Admin initialized successfully'));
} catch (error) {
    console.error(chalk.red('\nFirebase initialization failed'));
    console.error(chalk.yellow(`  ${error.message}\n`));

    process.exit(1);
}

export default firebaseAdmin;
