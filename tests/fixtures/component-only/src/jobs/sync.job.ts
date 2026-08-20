import { UserRepository } from "../repositories/user.repository";

export class SyncJob {
  public constructor(private readonly users: UserRepository) {}
}
