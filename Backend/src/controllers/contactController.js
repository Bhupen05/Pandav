import Contact, { CONTACT_LIMITS, CONTACT_STATUSES } from '../models/Contact.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { escapeRegex, listResponse, pick, sendServerError } from '../utils/http.js';
import { mailEnabled, sendMail } from '../utils/mailer.js';
import { adminIds, notify } from '../utils/notify.js';

const NOT_FOUND = { success: false, message: 'Contact message not found' };

// Ways the inbox can be ordered (?sort=); `_id` keeps pages stable when two
// messages share a time
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
  name: { name: 1, _id: 1 },
};

// Who resolved a message and who wrote each reply, for the inbox
const withPeople = (query) => query
  .populate('resolvedBy', 'name email')
  .populate('replies.by', 'name email');

// Whether a hidden field that people never see (and so never fill in) has a
// value: only form-filling bots send one
const isBot = (website) =>
  website !== undefined && website !== null && String(website).trim() !== '';

const excerpt = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

// @desc    Get all contact messages. ?status= one status; ?q= text in the
//          name, email, subject or message; ?sort= newest (default), oldest,
//          updated or name; ?page=&limit= to page.
// @route   GET /api/v2/contact
// @access  Private (Admin)
export const getContacts = async (req, res) => {
  try {
    const { status, q, sort = 'newest' } = req.query;
    const filter = {};

    if (status && status !== 'all') {
      if (!CONTACT_STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      filter.status = status;
    }

    if (typeof q === 'string' && q.trim()) {
      // Matched as plain text, not as a regular expression
      const pattern = { $regex: escapeRegex(q.trim().slice(0, 200)), $options: 'i' };
      filter.$or = ['name', 'email', 'subject', 'message'].map((field) => ({ [field]: pattern }));
    }

    if (typeof sort !== 'string' || !SORTS[sort]) {
      return res.status(400).json({ success: false, message: 'Invalid sort' });
    }

    const query = withPeople(Contact.find(filter)).sort(SORTS[sort]);

    res.json(await listResponse(Contact, filter, query, req.query));
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    How many contact messages there are in each status
// @route   GET /api/v2/contact/stats
// @access  Private (Admin)
export const getContactStats = async (req, res) => {
  try {
    const counts = await Contact.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byStatus = Object.fromEntries(CONTACT_STATUSES.map((status) => [status, 0]));
    let total = 0;
    for (const { _id, count } of counts) {
      if (_id in byStatus) byStatus[_id] = count;
      total += count;
    }
    res.json({ success: true, data: { total, byStatus } });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Get single contact message
// @route   GET /api/v2/contact/:id
// @access  Private (Admin)
export const getContact = async (req, res) => {
  try {
    const contact = await withPeople(Contact.findById(req.params.id));

    if (!contact) {
      return res.status(404).json(NOT_FOUND);
    }

    res.json({
      success: true,
      data: contact,
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Create contact message, and tell the admins
// @route   POST /api/v2/contact
// @access  Public
export const createContact = async (req, res) => {
  try {
    // Public route: visitors can't set status, resolution fields or replies
    const fields = pick(req.body, ['name', 'email', 'phone', 'subject', 'message']);

    // A filled-in honeypot gets the same answer as a real message, so the bot
    // learns nothing, but nothing is stored and nobody is told
    if (isBot(req.body?.website)) {
      const decoy = new Contact(fields);
      decoy.createdAt = decoy.updatedAt = new Date();
      return res.status(201).json({
        success: true,
        data: decoy,
        message: 'Your message has been sent successfully',
      });
    }

    const contact = await Contact.create(fields);

    await notify(req, await adminIds(), {
      type: 'contact_message',
      title: excerpt(`New message from ${contact.name}: ${contact.subject}`, 200),
      body: excerpt(contact.message, 500),
      link: '/admin/messages',
      data: { contactId: String(contact._id) },
      email: true,
    });

    res.status(201).json({
      success: true,
      data: contact,
      message: 'Your message has been sent successfully',
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Update contact message status
// @route   PUT /api/v2/contact/:id
// @access  Private (Admin)
export const updateContact = async (req, res) => {
  try {
    const { status } = pick(req.body, ['status']);
    if (status === undefined) {
      return res.status(400).json({ success: false, message: 'Choose a status' });
    }

    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json(NOT_FOUND);
    }

    const previous = contact.status;
    if (status !== previous) {
      contact.status = status;
      if (status === 'resolved') {
        contact.resolvedBy = req.user._id;
        contact.resolvedAt = new Date();
      } else {
        // "Resolved by" describes the current state, so it goes when the
        // message is reopened or closed
        contact.resolvedBy = undefined;
        contact.resolvedAt = undefined;
      }
      await contact.save();

      await logAuditEventV2(req, {
        action: 'contact_status_changed',
        targetType: 'Contact',
        targetId: contact._id,
        details: { from: previous, to: contact.status },
      });
    }

    res.json({
      success: true,
      data: await withPeople(Contact.findById(contact._id)),
    });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Answer a contact message by email. The reply is kept on the message.
// @route   POST /api/v2/contact/:id/reply
// @access  Private (Admin)
export const replyToContact = async (req, res) => {
  try {
    const { message } = pick(req.body, ['message']);
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Write a reply first' });
    }
    if (message.trim().length > CONTACT_LIMITS.message) {
      return res.status(400).json({
        success: false,
        message: `A reply can be at most ${CONTACT_LIMITS.message} characters`,
      });
    }

    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json(NOT_FOUND);
    }

    if (!mailEnabled()) {
      return res.status(400).json({ success: false, message: "Email isn't set up on this server" });
    }

    // The answer, then what they wrote, as an email reply would quote it
    const sentOn = contact.createdAt ? ` of ${contact.createdAt.toISOString().slice(0, 10)}` : '';
    const text = [message.trim(), `---\nYour message${sentOn}:\n\n${contact.message}`].join('\n\n');
    const { sent } = await sendMail({
      to: contact.email,
      name: contact.name,
      subject: excerpt(`Re: ${contact.subject}`, 250),
      text,
    });

    // Every attempt is kept, failed ones too, so the inbox shows what the
    // sender actually received
    contact.replies.push({ by: req.user._id, message: message.trim(), at: new Date(), sent });
    if (contact.status === 'new') contact.status = 'in-progress';
    await contact.save();

    await logAuditEventV2(req, {
      action: 'contact_replied',
      targetType: 'Contact',
      targetId: contact._id,
      status: sent ? 'success' : 'failed',
      details: { sent, to: contact.email },
    });

    const data = await withPeople(Contact.findById(contact._id));
    if (!sent) {
      return res.status(502).json({
        success: false,
        message: "The reply was saved but the email couldn't be sent. Please try again later.",
        data,
      });
    }
    res.status(201).json({ success: true, data, message: 'Reply sent' });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete contact message
// @route   DELETE /api/v2/contact/:id
// @access  Private (Admin)
export const deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json(NOT_FOUND);
    }

    await contact.deleteOne();

    // The message itself is gone, so the record says what it was
    await logAuditEventV2(req, {
      action: 'contact_deleted',
      targetType: 'Contact',
      targetId: contact._id,
      details: { name: contact.name, email: contact.email, subject: contact.subject, status: contact.status },
    });

    res.json({
      success: true,
      message: 'Contact message deleted successfully',
    });
  } catch (error) {
    sendServerError(res, error);
  }
};
