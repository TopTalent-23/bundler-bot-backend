import { Router } from "express";
import { getUser } from "../controllers";

const router = Router();
router.get('/:id', getUser);
export default router;