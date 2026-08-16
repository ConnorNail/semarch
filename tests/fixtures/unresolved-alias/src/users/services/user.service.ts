import { MissingRepository } from "@app/repositories/missing.repository";

export class UserService {
  public constructor(private readonly missing: MissingRepository) {}
}
