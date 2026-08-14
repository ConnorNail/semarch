import { ProfileRepository } from "../repositories/profile";

export class ProfileService {
  public constructor(private readonly profiles: ProfileRepository) {}
}
