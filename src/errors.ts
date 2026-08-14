export class ArchitectureError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArchitectureError";
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
