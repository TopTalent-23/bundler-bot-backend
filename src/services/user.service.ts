import { UserModel } from "../models/user.model";

export const getUserById = (id: string) => UserModel.findById(id);