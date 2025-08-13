import express from 'express';
import { connectDB } from './config/db';
import cors from 'cors';
import routes from './routes';
import { TelegramLoginBot } from './telegram';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', routes);
const telegramLoginBot = new TelegramLoginBot();

const start = async () => {
    await connectDB(); // 🔌 Connect to MongoDB
    telegramLoginBot.start();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

start();