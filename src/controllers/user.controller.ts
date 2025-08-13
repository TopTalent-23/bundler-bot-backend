import { Request, Response } from 'express';
import * as userService from './../services';

type Params = {
  id: string;
};

export const getUser = async (req: Request<Params>, res: Response) => {
  const user = await userService.getUserById(req.params.id);
  res.json(user);
};
