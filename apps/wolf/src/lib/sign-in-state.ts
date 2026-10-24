export const signInCopy = {
  invalid: "The email or Wolf password is not valid.",
  rateLimited: "Too many attempts. Wait a few minutes and try again.",
  unavailable: "Sign-in is not available right now.",
  emailInvalid: "Enter a valid email address.",
  passwordInvalid: "Enter the Wolf password for this account.",
  rejected: "The request was rejected.",
} as const;

export type SignInFormState = {
  status: "idle" | "invalid" | "rate_limited" | "unavailable" | "validation";
  message: string;
  email: string;
};

export const initialSignInState: SignInFormState = {
  status: "idle",
  message: "",
  email: "",
};
