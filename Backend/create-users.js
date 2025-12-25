import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pandav_db';

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: String,
  phone: String,
  department: String,
  isActive: Boolean,
  createdAt: Date
});

const User = mongoose.model('User', userSchema);

async function createInitialUsers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if users already exist
    const existingAdmin = await User.findOne({ email: 'admin@example.com' });
    const existingUser = await User.findOne({ email: 'user@example.com' });

    if (existingAdmin && existingUser) {
      console.log('\n✓ Users already exist!');
      console.log('\nLogin Credentials:');
      console.log('─────────────────────────────────────');
      console.log('Admin: admin@example.com / admin123');
      console.log('User:  user@example.com / user123');
      console.log('─────────────────────────────────────\n');
      process.exit(0);
    }

    const salt = await bcrypt.genSalt(10);

    // Create admin user if doesn't exist
    if (!existingAdmin) {
      const hashedAdminPassword = await bcrypt.hash('admin123', salt);
      const admin = new User({
        name: 'Admin User',
        email: 'admin@example.com',
        password: hashedAdminPassword,
        role: 'admin',
        phone: '+1234567890',
        department: 'Management',
        isActive: true,
        createdAt: new Date()
      });
      await admin.save();
      console.log('✓ Admin user created');
    }

    // Create regular user if doesn't exist
    if (!existingUser) {
      const hashedUserPassword = await bcrypt.hash('user123', salt);
      const user = new User({
        name: 'Demo User',
        email: 'user@example.com',
        password: hashedUserPassword,
        role: 'user',
        phone: '+1234567891',
        department: 'Engineering',
        isActive: true,
        createdAt: new Date()
      });
      await user.save();
      console.log('✓ Regular user created');
    }

    console.log('\n✓ Initial users created successfully!');
    console.log('\nLogin Credentials:');
    console.log('─────────────────────────────────────');
    console.log('Admin: admin@example.com / admin123');
    console.log('User:  user@example.com / user123');
    console.log('─────────────────────────────────────\n');

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Error creating users:', error.message);
    process.exit(1);
  }
}

createInitialUsers();
