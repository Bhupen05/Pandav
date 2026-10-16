import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pandav_db';

// Passwords come from the environment, or are generated randomly and printed
// once. There are no shared default passwords.
const seedAccounts = [
  {
    name: 'Admin User',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD,
    role: 'admin',
    department: 'Management',
  },
  {
    name: 'Demo User',
    email: process.env.SEED_USER_EMAIL || 'user@example.com',
    password: process.env.SEED_USER_PASSWORD,
    role: 'user',
    department: 'Engineering',
  },
];

const randomPassword = () => crypto.randomBytes(12).toString('base64url');

async function createInitialUsers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    const created = [];
    for (const account of seedAccounts) {
      if (await User.exists({ email: account.email })) {
        console.log(`✓ ${account.email} already exists, leaving it unchanged`);
        continue;
      }

      const password = account.password || randomPassword();
      await User.create({ ...account, password });
      created.push({ email: account.email, password, role: account.role });
    }

    if (created.length > 0) {
      console.log('\nCreated accounts (save these passwords now, they are not shown again):');
      console.log('─────────────────────────────────────');
      for (const { email, password, role } of created) {
        console.log(`${role.padEnd(5)}  ${email} / ${password}`);
      }
      console.log('─────────────────────────────────────\n');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error creating users:', error.message);
    process.exit(1);
  }
}

createInitialUsers();
