import mongoose from 'mongoose';
import Task from '../models/Task.js';
import TaskComment, { COMMENT_MAX_LENGTH } from '../models/TaskComment.js';
import { sendServerError } from '../utils/http.js';
import { notify } from '../utils/notify.js';
import {
  LIST_SELECT,
  canViewTask,
  commentRecipients,
  idOf,
  isFrozenTeamTask,
  manageProblem,
  short,
  taskLink,
} from '../utils/tasks.js';
import { FROZEN_TEAM_MESSAGE } from '../utils/teams.js';

// Comments on a task: /api/v2/tasks/:id/comments. Anyone who can see the
// task reads and writes them; nothing changes on a frozen team's task except
// by an admin.

const PAGE_SIZE = 50;
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// A comment as the API returns it. A deleted one keeps its place but not its text.
const commentJson = (comment) => {
  const json = comment.toJSON();
  if (comment.deletedAt) {
    json.text = 'Comment deleted';
    json.deleted = true;
  } else {
    json.deleted = false;
  }
  return json;
};

// Loads the task in req.params.id for someone who can see it, or sends why not
const loadVisibleTask = async (req, res) => {
  const task = await Task.findById(req.params.id).select(LIST_SELECT);
  if (!task) {
    fail(res, 404, 'Task not found');
    return null;
  }
  if (!(await canViewTask(task, req.user))) {
    fail(res, 403, 'Not authorized to view this task');
    return null;
  }
  return task;
};

// Refuses changes to a frozen team's task, except by an admin
const refuseIfFrozen = async (req, res, task) => {
  if (req.user.role !== 'admin' && (await isFrozenTeamTask(task))) {
    fail(res, 400, FROZEN_TEAM_MESSAGE);
    return true;
  }
  return false;
};

// The comment text from a body, or { error }
const commentText = (value) => {
  if (typeof value !== 'string' || !value.trim()) return { error: 'Write something first' };
  const text = value.trim();
  if (text.length > COMMENT_MAX_LENGTH) return { error: `A comment can be at most ${COMMENT_MAX_LENGTH} characters` };
  return { text };
};

// The comment in req.params.commentId on this task, or sends 404
const loadComment = async (req, res, task) => {
  const comment = mongoose.isObjectIdOrHexString(req.params.commentId)
    ? await TaskComment.findOne({ _id: req.params.commentId, task: task._id }).populate('author', 'name')
    : null;
  if (!comment) fail(res, 404, 'Comment not found');
  return comment;
};

// @desc    A task's comments, oldest first, 50 at a time: the newest 50, or
//          with ?before=<id of the oldest shown> the 50 before it
// @route   GET /api/v2/tasks/:id/comments
// @access  Private (anyone who can see the task)
export const getComments = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;

    const { before } = req.query;
    if (before !== undefined && (typeof before !== 'string' || !mongoose.isObjectIdOrHexString(before))) {
      return fail(res, 400, 'Invalid before');
    }

    const newestFirst = await TaskComment.find({ task: task._id, ...(before && { _id: { $lt: before } }) })
      .sort({ _id: -1 })
      .limit(PAGE_SIZE + 1)
      .populate('author', 'name');
    const hasMore = newestFirst.length > PAGE_SIZE;
    const data = newestFirst.slice(0, PAGE_SIZE).reverse().map(commentJson);

    res.json({ success: true, count: data.length, hasMore, data });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Comment on a task
// @route   POST /api/v2/tasks/:id/comments
// @access  Private (anyone who can see the task)
export const addComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    if (await refuseIfFrozen(req, res, task)) return;

    const { text, error } = commentText(req.body?.text);
    if (error) return fail(res, 400, error);

    const comment = await TaskComment.create({ task: task._id, author: req.user._id, text });
    await Task.addHistory(task._id, req.user._id, 'comment_added', { commentId: String(comment._id) }, { $inc: { commentCount: 1 } });

    await notify(req, await commentRecipients(task), {
      type: 'task_comment',
      title: `${short(req.user.name, 60)} commented on ${short(task.title, 120)}`,
      body: short(text, 300),
      link: taskLink(task),
      data: { taskId: String(task._id), commentId: String(comment._id) },
    });

    await comment.populate('author', 'name');
    res.status(201).json({ success: true, data: commentJson(comment) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Edit your own comment
// @route   PATCH /api/v2/tasks/:id/comments/:commentId
// @access  Private (the comment's author)
export const editComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const comment = await loadComment(req, res, task);
    if (!comment) return;

    if (idOf(comment.author) !== idOf(req.user._id)) return fail(res, 403, 'Only its author can edit a comment');
    if (comment.deletedAt) return fail(res, 409, 'This comment was deleted');
    if (await refuseIfFrozen(req, res, task)) return;

    const { text, error } = commentText(req.body?.text);
    if (error) return fail(res, 400, error);

    if (text !== comment.text) {
      comment.text = text;
      comment.editedAt = new Date();
      await comment.save();
    }
    res.json({ success: true, data: commentJson(comment) });
  } catch (error) {
    sendServerError(res, error);
  }
};

// @desc    Delete a comment. It stays in the list as "Comment deleted".
// @route   DELETE /api/v2/tasks/:id/comments/:commentId
// @access  Private (its author, the task's managers, admins)
export const deleteComment = async (req, res) => {
  try {
    const task = await loadVisibleTask(req, res);
    if (!task) return;
    const comment = await loadComment(req, res, task);
    if (!comment) return;

    const isAuthor = idOf(comment.author) === idOf(req.user._id);
    if (!isAuthor && (await manageProblem(task, req.user))) {
      return fail(res, 403, "Only its author or the task's managers can delete a comment");
    }
    if (comment.deletedAt) return fail(res, 409, 'This comment was already deleted');
    if (await refuseIfFrozen(req, res, task)) return;

    comment.deletedAt = new Date();
    comment.text = '';
    await comment.save();
    await Task.updateOne({ _id: task._id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });

    res.json({ success: true, message: 'Comment deleted', data: commentJson(comment) });
  } catch (error) {
    sendServerError(res, error);
  }
};
