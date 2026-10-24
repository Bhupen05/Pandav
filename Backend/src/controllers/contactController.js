import Contact, { CONTACT_LIMITS, CONTACT_STATUSES } from '../models/Contact.js';
import User from '../models/User.js';
import { logAuditEventV2 } from '../utils/auditLoggerV2.js';
import { escapeRegex, listResponse, pick, sendServerError } from '../utils/http.js';
import { mailEnabled, sendMail } from '../utils/mailer.js';
import { adminIds, notify } from '../utils/notify.js';

const NOT_FOUND = { success: false, message: 'Contact message not found' };
const SENT = 'Your message has been sent successfully';

// Ways the inbox can be ordered (?sort=); `_id` keeps pages stable when two
// messages share a time
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  updated: { updatedAt: -1, _id: -1 },
  name: { name: 1, _id: 1 },
};

// Messages as admins see them, with who resolved each one and who wrote each
// reply filled in as { _id, name, email }. An account removed before deleted
// accounts were kept (anonymised) has no record left, and shows as
// "Deleted user" too. Takes what a find() returned: one message, null or a list.
const withPeople = async (found) => {
  const contacts = [].concat(found ?? []).map((contact) => contact.toJSON());
  for (const contact of contacts) contact.replies = contact.replies || [];

  const ids = contacts
    .flatMap((contact) => [contact.resolvedBy, ...contact.replies.map((reply) => reply.by)])
    .filter(Boolean);
  const people = new Map();
  if (ids.length > 0) {
    const users = await User.find({ _id: { $in: [...new Set(ids.map(String))] } }).select('name email').lean();
    for (const user of users) people.set(String(user._id), user);
  }
  const person = (id) => people.get(String(id)) || { _id: id, name: 'Deleted user', email: null };

  for (const contact of contacts) {
    if (contact.resolvedBy) contact.resolvedBy = person(contact.resolvedBy);
    for (const reply of contact.replies) {
      if (reply.by) reply.by = person(reply.by);
    }
  }
  return Array.isArray(found) ? contacts : (contacts[0] ?? null);
};

// Whether a hidden field that people never see (and so never fill in) has a
// value: only form-filling bots send one
const isBot = (website) =>
  website !== undefined && website !== null && String(website).trim() !== '';

const excerpt = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

// Tells every active admin about a new message, by email too. Runs after the
// visitor has had their answer, so the form never waits for the mail server.
// Never throws.
const tellAdmins = async (contact) => {
  try {
    // No actor: the sender has no account
    await notify(null, await adminIds(), {
      type: 'contact_message',
      title: excerpt(`New message from ${contact.name}: ${contact.subject}`, 200),
      body: excerpt(contact.message, 500),
      link: '/admin/messages',
      data: { contactId: String(contact._id) },
      email: true,
    });
  } catch (error) {
    console.error('Contact notification failed:', error.message);
  }
};

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

    // Own keys only: "constructor" or "__proto__" are not ways to sort
    if (typeof sort !== 'string' || !Object.hasOwn(SORTS, sort)) {
      return res.status(400).json({ success: false, message: 'Invalid sort' });
    }

    const result = await listResponse(Contact, filter, Contact.find(filter).sort(SORTS[sort]), req.query);
    result.data = await withPeople(result.data);
    res.json(result);
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
      if (typeof _id === 'string' && Object.hasOwn(byStatus, _id)) byStatus[_id] = count;
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
    const contact = await withPeople(await Contact.findById(req.params.id));

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

    // A filled-in honeypot gets the answer a real message gets, so the bot
    // can't tell it was caught: the same checks (a refused field is still a
    // 400) and the same 201 body. But nothing is stored and nobody is told.
    if (isBot(req.body?.website)) {
      const decoy = new Contact(fields);
      await decoy.validate();
      // What saving adds to a stored message
      decoy.initializeTimestamps();
      decoy.set(Contact.schema.options.versionKey, 0);
      return res.status(201).json({ success: true, data: decoy, message: SENT });
    }

    const contact = await Contact.create(fields);

    res.status(201).json({ success: true, data: contact, message: SENT });

    // Only now, so a slow or unreachable mail server never holds up the answer
    void tellAdmins(contact);
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
    // Checked here: the schema's enum would let null through
    if (typeof status !== 'string' || !CONTACT_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
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
      // Messages sent before the field limits may be longer; they can still be handled
      await contact.save({ validateModifiedOnly: true });

      await logAuditEventV2(req, {
        action: 'contact_status_changed',
        targetType: 'Contact',
        targetId: contact._id,
        details: { from: previous, to: contact.status },
      });
    }

    res.json({
      success: true,
      data: await withPeople(await Contact.findById(contact._id)),
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
    // sender actually received. The email can take seconds and another admin
    // may change the message meanwhile, so these update what is stored now
    // rather than saving the copy read before sending: a status set meanwhile
    // stands, and only a message that is still `new` moves on.
    const reply = { by: req.user._id, message: message.trim(), at: new Date(), sent };
    const { matchedCount } = await Contact.updateOne(
      { _id: contact._id },
      { $push: { replies: reply } },
      { runValidators: true },
    );
    if (matchedCount > 0) {
      await Contact.updateOne({ _id: contact._id, status: 'new' }, { $set: { status: 'in-progress' } });
    }

    await logAuditEventV2(req, {
      action: 'contact_replied',
      targetType: 'Contact',
      targetId: contact._id,
      status: sent ? 'success' : 'failed',
      details: { sent, to: contact.email },
    });

    // Deleted while the email was being sent: there is nothing to keep the reply on
    const data = await withPeople(await Contact.findById(contact._id));
    if (!data) {
      return res.status(404).json(NOT_FOUND);
    }
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
