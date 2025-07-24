const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const resourceRoutes = require('./routes/resourceRoutes');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resourcelocking';

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.error(' MongoDB connection error:', err));

app.get('/', (req, res) => {
  res.json({
    message: 'Resource Locking System API',
    version: '1.0.0',
    endpoints: {
      'GET /api/resources': 'Get all resources with lock status',
      'GET /api/resources/:resourceName': 'Get specific resource lock status',
      'POST /api/resources/lock': 'Lock a resource',
      'POST /api/resources/unlock': 'Unlock a resource',
      'DELETE /api/resources/:resourceName/force-unlock': 'Force unlock (admin)',
      'GET /health': 'Health check'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

app.use('/api/resources', resourceRoutes);

app.use(notFound);
app.use(errorHandler);

setInterval(async () => {
  try {
    const ResourceLock = require('./models/ResourceLock');
    const result = await ResourceLock.deleteMany({
      expiresAt: { $lt: new Date() }
    });
    if (result.deletedCount > 0) {
      console.log(` Cleaned up ${result.deletedCount} expired locks`);
    }
  } catch (error) {
    console.error('Error cleaning expired locks:', error);
  }
}, 60000);

app.listen(PORT, () => {
  console.log(` Resource Locking System running on port ${PORT}`);
  console.log(` Access URL: http://localhost:${PORT}`);
});

module.exports = app;