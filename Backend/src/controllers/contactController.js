import Contact from '../models/Contact.js';

// @desc    Get all contact messages
// @route   GET /api/contact
// @access  Private (Admin)
export const getContacts = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};

    if (status) filter.status = status;

    const contacts = await Contact.find(filter)
      .populate('resolvedBy', 'name email')
      .sort('-createdAt');

    res.json({
      success: true,
      count: contacts.length,
      data: contacts,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Get single contact message
// @route   GET /api/contact/:id
// @access  Private (Admin)
export const getContact = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id)
      .populate('resolvedBy', 'name email');

    if (!contact) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contact message not found' 
      });
    }

    res.json({
      success: true,
      data: contact,
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Create contact message
// @route   POST /api/contact
// @access  Public
export const createContact = async (req, res) => {
  try {
    const contact = await Contact.create(req.body);

    res.status(201).json({
      success: true,
      data: contact,
      message: 'Your message has been sent successfully',
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Update contact message status
// @route   PUT /api/contact/:id
// @access  Private (Admin)
export const updateContact = async (req, res) => {
  try {
    const { status } = req.body;

    let contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contact message not found' 
      });
    }

    // If marking as resolved, set resolvedBy and resolvedAt
    if (status === 'resolved' && contact.status !== 'resolved') {
      req.body.resolvedBy = req.user.id;
      req.body.resolvedAt = new Date();
    }

    contact = await Contact.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate('resolvedBy', 'name email');

    res.json({
      success: true,
      data: contact,
    });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// @desc    Delete contact message
// @route   DELETE /api/contact/:id
// @access  Private (Admin)
export const deleteContact = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({ 
        success: false, 
        message: 'Contact message not found' 
      });
    }

    await contact.deleteOne();

    res.json({
      success: true,
      message: 'Contact message deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};
