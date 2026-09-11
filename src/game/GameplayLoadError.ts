export class GameplayLoadError extends Error {
  constructor(cause: unknown) {
    super(
      'The game engine could not be downloaded. Check your connection, then choose Reload to try again.',
      { cause },
    );
    this.name = 'GameplayLoadError';
  }
}
