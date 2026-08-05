export class LinguiniError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LinguiniError';
    }
}
