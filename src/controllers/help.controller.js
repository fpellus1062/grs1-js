const service = require('../services/help.services');
const ApiError = require('../utils/ApiError');

// GET ALL
const getAllHelp = async (req, res, next) => {
  try {
    const result = await service.getAllHelp();
    res.json({ ok: true, result });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

// GET BY CONTEXT
const getHelpByContext = async (req, res, next) => {
  try {
    const { context } = req.params;
    const result = await service.getHelpByContext(context);
    res.json({ ok: true, result });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

// CREATE
const createHelp = async (req, res, next) => {
  try {
    const { title, content, type, context } = req.body;
    const result = await service.createHelp({ title, content, type, context });
    res.json({ ok: true, result });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

// UPDATE
const updateHelp = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, content, type, context } = req.body;
    const result = await service.updateHelp(id, {
      title,
      content,
      type,
      context,
    });
    res.json({ ok: true, result });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

// DELETE
const deleteHelp = async (req, res, next) => {
  try {
    const { id } = req.params;
    await service.deleteHelp(id);
    res.json({ ok: true, message: 'Deleted' });
  } catch (err) {
    next(new ApiError(500, err.message));
  }
};

module.exports = {
  getAllHelp,
  getHelpByContext,
  createHelp,
  updateHelp,
  deleteHelp,
};
