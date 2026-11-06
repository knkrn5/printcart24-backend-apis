// utils/checkAdmin.util.js
import chalk from 'chalk';
import Admin from '#models/admin';

export const checkAdminExists = async () => {
    try {
        const superAdmin = await Admin.findOne({ role: 'SUPER_ADMIN' }).select('email');

        if (!superAdmin) {
            console.log(chalk.redBright('🚨 CRITICAL: No SUPER ADMIN user found in the database.'));

            throw {
                status: 404,
                message: 'No SUPER ADMIN user found. Please run seed script to initialize.',
            };
        }

        console.log(chalk.green(`✅ SUPER ADMIN found: ${superAdmin.email}`));
    } catch (error) {
        if (error.status === 404) {
            throw error;
        }

        console.error(chalk.red('Error while checking ADMIN existence:'), error.message);

        throw {
            status: 500,
            message: 'Server startup failed while checking for ADMIN user.',
        };
    }
};
