const express = require('express');
const router = express.Router();
const ResourceLock = require('../models/ResourceLock');
const { validateLockRequest, validateUnlockRequest } = require('../middleware/validation');

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, lockedBy, lockType } = req.query;
    
    let query = { expiresAt: { $gt: new Date() } };
    
    if (lockedBy) query.lockedBy = new RegExp(lockedBy, 'i');
    if (lockType) query.lockType = lockType;
    
    const locks = await ResourceLock.find(query)
      .sort({ lockedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');
    
    const total = await ResourceLock.countDocuments(query);
    
    const locksWithStatus = locks.map(lock => ({
      resourceName: lock.resourceName,
      lockedBy: lock.lockedBy,
      lockType: lock.lockType,
      lockedAt: lock.lockedAt,
      expiresAt: lock.expiresAt,
      remainingTime: lock.remainingTime,
      isExpired: lock.isExpired,
      metadata: lock.metadata
    }));
    
    res.json({
      success: true,
      data: locksWithStatus,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalResources: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching resources',
      error: error.message
    });
  }
});

router.get('/:resourceName', async (req, res) => {
  try {
    const { resourceName } = req.params;
    
    const lock = await ResourceLock.getLockInfo(resourceName);
    
    if (!lock) {
      return res.json({
        success: true,
        data: {
          resourceName,
          isLocked: false,
          message: 'Resource is available'
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        resourceName: lock.resourceName,
        isLocked: true,
        lockedBy: lock.lockedBy,
        lockType: lock.lockType,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
        remainingTime: lock.remainingTime,
        lockDuration: lock.lockDuration,
        metadata: lock.metadata
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking resource status',
      error: error.message
    });
  }
});

router.post('/lock', validateLockRequest, async (req, res) => {
  try {
    const { 
      resourceName, 
      lockedBy, 
      lockDuration = 300, 
      lockType = 'exclusive',
      purpose = '',
      sessionId = ''
    } = req.body;
    
    const existingLock = await ResourceLock.getLockInfo(resourceName);
    
    if (existingLock) {
      return res.status(409).json({
        success: false,
        message: 'Resource is already locked',
        data: {
          resourceName: existingLock.resourceName,
          lockedBy: existingLock.lockedBy,
          expiresAt: existingLock.expiresAt,
          remainingTime: existingLock.remainingTime
        }
      });
    }
    
    const expiresAt = new Date(Date.now() + (lockDuration * 1000));
    
    const newLock = new ResourceLock({
      resourceName,
      lockedBy,
      lockType,
      expiresAt,
      lockDuration,
      metadata: {
        clientIp: req.ip,
        userAgent: req.get('User-Agent'),
        sessionId,
        purpose
      }
    });
    
    await newLock.save();
    
    res.status(201).json({
      success: true,
      message: 'Resource locked successfully',
      data: {
        resourceName: newLock.resourceName,
        lockedBy: newLock.lockedBy,
        lockType: newLock.lockType,
        lockedAt: newLock.lockedAt,
        expiresAt: newLock.expiresAt,
        remainingTime: newLock.remainingTime,
        lockId: newLock._id
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Resource is already locked by another process'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error locking resource',
      error: error.message
    });
  }
});

router.post('/unlock', validateUnlockRequest, async (req, res) => {
  try {
    const { resourceName, lockedBy } = req.body;
    
    const lock = await ResourceLock.findOne({
      resourceName,
      lockedBy,
      expiresAt: { $gt: new Date() }
    });
    
    if (!lock) {
      return res.status(404).json({
        success: false,
        message: 'Lock not found or you are not authorized to unlock this resource'
      });
    }
    
    await ResourceLock.deleteOne({ _id: lock._id });
    
    res.json({
      success: true,
      message: 'Resource unlocked successfully',
      data: {
        resourceName,
        unlockedBy: lockedBy,
        unlockedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error unlocking resource',
      error: error.message
    });
  }
});

router.put('/:resourceName/extend', async (req, res) => {
  try {
    const { resourceName } = req.params;
    const { lockedBy, additionalSeconds = 300 } = req.body;
    
    const lock = await ResourceLock.findOne({
      resourceName,
      lockedBy,
      expiresAt: { $gt: new Date() }
    });
    
    if (!lock) {
      return res.status(404).json({
        success: false,
        message: 'Lock not found or you are not authorized to extend this lock'
      });
    }
    
    await lock.extendLock(additionalSeconds);
    
    res.json({
      success: true,
      message: 'Lock extended successfully',
      data: {
        resourceName: lock.resourceName,
        expiresAt: lock.expiresAt,
        remainingTime: lock.remainingTime,
        extendedBy: additionalSeconds
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error extending lock',
      error: error.message
    });
  }
});

router.delete('/:resourceName/force-unlock', async (req, res) => {
  try {
    const { resourceName } = req.params;
    const { adminKey } = req.body;
    
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Invalid admin key'
      });
    }
    
    const result = await ResourceLock.deleteOne({ resourceName });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Resource lock not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Resource force unlocked successfully',
      data: {
        resourceName,
        forceUnlockedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error force unlocking resource',
      error: error.message
    });
  }
});

module.exports = router;