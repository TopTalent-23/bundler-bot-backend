import express from 'express';
import { launchToken } from './../controllers';

const router = express.Router();

// POST /api/launch
router.post('/', launchToken);

export default router;
