const Joi = require('joi');

const lockRequestSchema = Joi.object({
  resourceName: Joi.string().min(1).max(255).required()
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .messages({
      'string.pattern.base': 'Resource name can only contain alphanumeric characters, dots, hyphens, and underscores'
    }),
  lockedBy: Joi.string().min(1).max(100).required(),
  lockDuration: Joi.number().integer().min(1).max(86400).default(300), 
  lockType: Joi.string().valid('read', 'write', 'exclusive').default('exclusive'),
  purpose: Joi.string().max(255).default(''),
  sessionId: Joi.string().max(100).default('')
});

const unlockRequestSchema = Joi.object({
  resourceName: Joi.string().min(1).max(255).required()
    .pattern(/^[a-zA-Z0-9._-]+$/),
  lockedBy: Joi.string().min(1).max(100).required()
});

const validateLockRequest = (req, res, next) => {
  const { error, value } = lockRequestSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message)
    });
  }
  
  req.body = value; 
  next();
};

const validateUnlockRequest = (req, res, next) => {
  const { error, value } = unlockRequestSchema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: error.details.map(detail => detail.message)
    });
  }
  
  req.body = value;
  next();
};

const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  res.status(statusCode).json({
    success: false,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  validateLockRequest,
  validateUnlockRequest,
  notFound,
  errorHandler
};