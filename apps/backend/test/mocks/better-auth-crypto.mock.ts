export const hashPassword = jest.fn(async (password: string) => `hashed_${password}`);
export const checkPassword = jest.fn(async (_opts: { password: string; hash: string }) => true);
