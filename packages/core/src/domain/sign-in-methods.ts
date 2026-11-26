// Which ways of signing in a server offers (T4-04 D6). Nothing says otherwise until T10-06 reads it from the server.
export type SignInMethods = { readonly password: "offered" | "hidden" };

export const DEFAULT_SIGN_IN_METHODS: SignInMethods = { password: "offered" };
