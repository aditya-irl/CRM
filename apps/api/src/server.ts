import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { initDatabase } from './database/db';
import { seedDatabase } from './database/seed';

const PORT = process.env.PORT || 4000;

// Initialize database schema and seed initial production-grade data if fresh
initDatabase();
seedDatabase();

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Finance & EMI Collection CRM API is running`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🩺 Health: http://localhost:${PORT}/health`);
  console.log(`====================================================`);
});
