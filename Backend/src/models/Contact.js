import mongoose from 'mongoose';
import validator from 'validator';

export const CONTACT_STATUSES = ['new', 'in-progress', 'resolved', 'closed'];

// Longest values the public form accepts (shown by the form, see Doc/Contact.md)
export const CONTACT_LIMITS = { name: 100, email: 254, phone: 30, subject: 200, message: 5000 };

// An admin's answer, emailed to the sender from the inbox
const contactReplySchema = new mongoose.Schema({
  by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    required: [true, 'Write a reply first'],
    trim: true,
    maxlength: [CONTACT_LIMITS.message, `A reply can be at most ${CONTACT_LIMITS.message} characters`],
  },
  at: {
    type: Date,
    default: Date.now,
  },
  // Whether the email went out
  sent: {
    type: Boolean,
    default: false,
  },
});

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [CONTACT_LIMITS.name, `Name can be at most ${CONTACT_LIMITS.name} characters`],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    maxlength: [CONTACT_LIMITS.email, `Email can be at most ${CONTACT_LIMITS.email} characters`],
    validate: [validator.isEmail, 'Please provide a valid email'],
  },
  phone: {
    type: String,
    trim: true,
    maxlength: [CONTACT_LIMITS.phone, `Phone can be at most ${CONTACT_LIMITS.phone} characters`],
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    trim: true,
    maxlength: [CONTACT_LIMITS.subject, `Subject can be at most ${CONTACT_LIMITS.subject} characters`],
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [CONTACT_LIMITS.message, `Message can be at most ${CONTACT_LIMITS.message} characters`],
  },
  status: {
    type: String,
    // Required as well: the enum alone lets null through
    required: true,
    enum: CONTACT_STATUSES,
    default: 'new',
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  resolvedAt: {
    type: Date,
  },
  replies: {
    type: [contactReplySchema],
    default: [],
  },
}, {
  timestamps: true,
});

contactSchema.index({ status: 1, createdAt: -1 });
contactSchema.index({ createdAt: -1 });

const Contact = mongoose.model('Contact', contactSchema);

export default Contact;
