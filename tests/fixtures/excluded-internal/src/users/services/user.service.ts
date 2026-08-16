import { UserRepository } from "../repositories/user.repository";

export class UserService {
  public constructor(private readonly users: UserRepository) {}
}
